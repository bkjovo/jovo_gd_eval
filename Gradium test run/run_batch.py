"""
run_batch.py — batch reference-free TTS eval over a JSONL manifest.

For each manifest item:
  * QUALITY  — one buffered synthesis (client.tts) saved as a listenable WAV,
               then signal sanity + WER/CER (ASR vs text) + UTMOS.
  * LATENCY  — N separate timed streaming trials (client.tts_stream), plus one
               discarded warmup, giving client-side TTFA / total / RTF stats.

Quality and latency use independent synthesis calls (decoupled by design).
Whisper + UTMOS models load once and are reused across all items.

Outputs (in --out-dir, default outputs/):
  <id>.wav        per-item quality audio
  results.csv     one row per item, key metrics
  results.json    full detail incl. ASR hypotheses and every latency trial

Run:
    uv run --env-file .env python run_batch.py
    uv run --env-file .env python run_batch.py --trials 5 --asr-model small

WARNING: billable. Per item = (1 quality + 1 warmup + trials) calls * chars.
UTMOS is English-trained; treat es/fr/de MOS as a rough relative signal only.
"""

import argparse
import asyncio
import csv
import json
import os
import sys
from pathlib import Path

import gradium
from evaluate import (
    load_asr, load_utmos, load_dnsmos, load_mono, signal_sanity,
    intelligibility, predicted_mos, prosody, audio_quality, truncation_check,
)
from gradium_ttfa import trial_stream, summarize


def read_manifest(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


async def process_item(client, item, asr, utmos, dnsmos, trials, warmup, out_dir):
    setup = {
        "model_name": "default",
        "voice_id": item["voice_id"],
        "output_format": "wav",
        "json_config": {"rewrite_rules": item["lang"]},
    }
    text = item["text"]

    # --- QUALITY: one buffered synthesis, saved and scored ---
    result = await client.tts(setup=setup, text=text)
    wav_path = out_dir / f"{item['id']}.wav"
    wav_path.write_bytes(result.raw_data)

    wav, sr = load_mono(str(wav_path))
    sig = signal_sanity(wav, sr)
    intel = intelligibility(str(wav_path), text, asr, language=item["lang"])
    trunc = truncation_check(sig["duration_s"], intel["ref_words"],
                             intel["trailing_deletions"], sig["trail_silence_s"])
    pros = prosody(wav, sr, n_words=intel["ref_words"])
    mos = predicted_mos(wav, sr, utmos)
    aud = audio_quality(wav, sr, dnsmos)

    # --- LATENCY: warmup (discarded) + N timed streaming trials ---
    for _ in range(warmup):
        await trial_stream(client, setup, text)
    latency_trials = [await trial_stream(client, setup, text) for _ in range(trials)]
    ttfa = summarize([t["ttfa"] for t in latency_trials])
    total = summarize([t["total"] for t in latency_trials])
    rtf = summarize([t["rtf"] for t in latency_trials])

    return {
        "id": item["id"],
        "lang": item["lang"],
        "voice_name": item.get("voice_name", ""),
        "voice_id": item["voice_id"],
        "chars": len(text),
        "audio_s": round(sig["duration_s"], 3),
        "wer_pct": round(intel["wer"] * 100, 2),
        "cer_pct": round(intel["cer"] * 100, 2),
        # Needed to micro-average WER across a corpus (sum errors / sum reference
        # words). Averaging per-clip WERs instead over-weights short clips.
        "ref_words": intel["ref_words"],
        "detected_lang": intel["detected_lang"],
        # D-INT-3 / D-INT-6: alignment error breakdown
        "sub": intel["substitutions"],
        "ins": intel["insertions"],
        "del": intel["deletions"],
        # D-INT-5: truncation / early cutoff
        "trailing_del": intel["trailing_deletions"],
        "dur_expected_ratio": round(trunc["dur_expected_ratio"], 3),
        "truncated": trunc["truncated"],
        # D-NAT-1 / D-NAT-3: prosody
        "f0_semitone_std": round(pros["f0_semitone_std"], 3),
        "f0_mean_hz": round(pros["f0_mean_hz"], 1),
        "n_pauses": pros["n_pauses"],
        "speaking_rate_wps": round(pros["speaking_rate_wps"], 3) if pros["speaking_rate_wps"] == pros["speaking_rate_wps"] else None,
        # D-AUD-1: DNSMOS
        "dnsmos_ovrl": round(aud["dnsmos_ovrl"], 3),
        "dnsmos_sig": round(aud["dnsmos_sig"], 3),
        "dnsmos_bak": round(aud["dnsmos_bak"], 3),
        "utmos": round(mos["utmos"], 3),
        # D-AUD-2: level / clipping
        "lufs": round(sig["lufs"], 2),
        "peak_dbfs": round(sig["peak_dbfs"], 2),
        "clipping_pct": round(sig["clipping_pct"], 3),
        "snr_db_est": round(sig["snr_db_est"], 1),
        "ttfa_p50_ms": round(ttfa["p50"] * 1000, 1),
        "ttfa_p90_ms": round(ttfa["p90"] * 1000, 1),
        "ttfa_iqr_ms": round(ttfa["iqr"] * 1000, 1),
        "total_p50_ms": round(total["p50"] * 1000, 1),
        "rtf_p50": round(rtf["p50"], 3),
        "_hypothesis": intel["hypothesis"],
        "_latency_trials": latency_trials,
        "_ttfa": ttfa, "_total": total, "_rtf": rtf,
    }


CSV_FIELDS = [
    "id", "lang", "voice_name", "chars", "audio_s",
    "wer_pct", "cer_pct", "sub", "ins", "del",
    "trailing_del", "dur_expected_ratio", "truncated",
    "f0_semitone_std", "f0_mean_hz", "n_pauses", "speaking_rate_wps",
    "dnsmos_ovrl", "dnsmos_sig", "dnsmos_bak", "utmos",
    "detected_lang", "lufs", "peak_dbfs", "clipping_pct", "snr_db_est",
    "ttfa_p50_ms", "ttfa_p90_ms", "ttfa_iqr_ms", "total_p50_ms", "rtf_p50",
]


async def main():
    ap = argparse.ArgumentParser(description="Batch reference-free TTS eval")
    ap.add_argument("--manifest", default="manifest.jsonl")
    ap.add_argument("--out-dir", default="outputs")
    ap.add_argument("--trials", type=int, default=5, help="timed latency trials per item")
    ap.add_argument("--warmup", type=int, default=1, help="discarded warmup trials per item")
    ap.add_argument("--asr-model", default="small")
    args = ap.parse_args()

    api_key = os.environ.get("GRADIUM_API_KEY")
    if not api_key:
        raise SystemExit("Set GRADIUM_API_KEY (run via: uv run --env-file .env python run_batch.py)")

    items = read_manifest(args.manifest)
    calls_per_item = 1 + args.warmup + args.trials
    est_credits = sum(len(it["text"]) for it in items) * calls_per_item
    print(f"manifest: {len(items)} items | {calls_per_item} calls/item "
          f"(1 quality + {args.warmup} warmup + {args.trials} timed)")
    print(f"est. cost ≈ {est_credits} credits\n")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(exist_ok=True)

    print("loading models (Whisper + UTMOS + DNSMOS)...", flush=True)
    asr = load_asr(args.asr_model)
    utmos = load_utmos()
    dnsmos = load_dnsmos()

    client = gradium.client.GradiumClient(api_key=api_key)
    rows = []
    for it in items:
        try:
            row = await process_item(client, it, asr, utmos, dnsmos, args.trials, args.warmup, out_dir)
            rows.append(row)
            trunc_flag = " TRUNC" if row["truncated"] else ""
            print(f"  [{row['id']:5s}] {row['lang']}  WER {row['wer_pct']:5.1f}%{trunc_flag}  "
                  f"UTMOS {row['utmos']:.2f}  DNSMOS {row['dnsmos_ovrl']:.2f}  "
                  f"f0std {row['f0_semitone_std']:.1f}st  TTFA {row['ttfa_p50_ms']:6.1f}ms "
                  f"(IQR {row['ttfa_iqr_ms']:.1f})  RTF {row['rtf_p50']:.3f}", flush=True)
        except Exception as exc:  # noqa: BLE001 - keep batch alive, log the failure
            print(f"  [{it['id']:5s}] FAILED -> {type(exc).__name__}: {exc}", flush=True)

    if not rows:
        print("\nno successful items — nothing written")
        return 1

    with open(out_dir / "results.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    with open(out_dir / "results.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    print(f"\nwrote {out_dir/'results.csv'} and results.json ({len(rows)} items)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
