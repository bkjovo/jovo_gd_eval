"""
run_batch.py — batch reference-free TTS eval over a JSONL manifest.

For each manifest item:
  * QUALITY  — one buffered synthesis (client.tts) saved as a listenable WAV,
               then signal sanity + WER/CER (ASR vs text) + UTMOS + DNSMOS.
  * LATENCY  — N separate timed streaming trials (client.tts_stream), plus one
               discarded warmup, giving client-side TTFA / total / RTF stats.
               Skipped entirely for items not in the latency selection (trials=0).

Quality and latency use independent synthesis calls (decoupled by design).
Whisper + UTMOS + DNSMOS models load once and are reused across all items.

INCREMENTAL BY DEFAULT. Existing results are loaded and merged, not overwritten:
  * an item already scored (in results.json AND its .wav exists) is SKIPPED, so a
    re-run costs nothing for work already done — add clips without re-billing the set;
  * only newly-processed items are re-synthesized; everyone else is carried through;
  * --force reprocesses everything, --only <ids> targets specific items,
    --prune drops result rows no longer in the manifest.

Outputs (in --out-dir, default outputs/):
  <id>.wav        per-item quality audio
  results.csv     one row per item, key metrics
  results.json    full detail incl. ASR hypotheses and every latency trial

Run:
    uv run --env-file .env python run_batch.py --manifest corpus/manifest_125.jsonl --out-dir corpus/outputs
    # recommended v2 run: quality on all, latency (5 trials) only on a stratified subset
    uv run --env-file .env python run_batch.py --manifest corpus/manifest_125.jsonl \
        --out-dir corpus/outputs \
        --latency-ids cs-01,bank-06,game-04,bank-01,health-01,game-02,cs-08,bank-07,game-07
    # add or fix a few clips later (only these are billed):
    uv run --env-file .env python run_batch.py --manifest corpus/manifest_125.jsonl \
        --out-dir corpus/outputs --only bank-03-fr,bank-03-de

WARNING: billable. Per processed item = 1 quality + (warmup + trials) latency calls,
each charged over the item's character count. Skipped items cost nothing.
UTMOS/DNSMOS are English-trained; compare MOS within a language only.
"""

import argparse
import asyncio
import csv
import json
import os
import sys
import uuid
from datetime import datetime, timezone
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


def load_existing(results_path):
    """Prior results keyed by id, so a re-run merges instead of clobbering."""
    if not results_path.exists():
        return {}
    with open(results_path, encoding="utf-8") as f:
        return {row["id"]: row for row in json.load(f)}


# --- empty latency block for quality-only items (trials=0) ---
_EMPTY_LATENCY = {
    "ttfa_p50_ms": None, "ttfa_p90_ms": None, "ttfa_iqr_ms": None,
    "total_p50_ms": None, "rtf_p50": None,
    "_latency_trials": [], "_ttfa": None, "_total": None, "_rtf": None,
}


async def process_item(client, item, asr, utmos, dnsmos, trials, warmup, out_dir, run_id):
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

    # --- LATENCY: warmup (discarded) + N timed trials, or skipped when trials=0 ---
    if trials > 0:
        for _ in range(warmup):
            await trial_stream(client, setup, text)
        latency_trials = [await trial_stream(client, setup, text) for _ in range(trials)]
        ttfa = summarize([t["ttfa"] for t in latency_trials])
        total = summarize([t["total"] for t in latency_trials])
        rtf = summarize([t["rtf"] for t in latency_trials])
        lat = {
            "ttfa_p50_ms": round(ttfa["p50"] * 1000, 1),
            "ttfa_p90_ms": round(ttfa["p90"] * 1000, 1),
            "ttfa_iqr_ms": round(ttfa["iqr"] * 1000, 1),
            "total_p50_ms": round(total["p50"] * 1000, 1),
            "rtf_p50": round(rtf["p50"], 3),
            "_latency_trials": latency_trials,
            "_ttfa": ttfa, "_total": total, "_rtf": rtf,
        }
    else:
        lat = dict(_EMPTY_LATENCY)

    row = {
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
        "_hypothesis": intel["hypothesis"],
        # Which run produced this row. Latency across different runs is NOT comparable
        # (different network/day); the UI can use _run_id to avoid pooling across runs.
        "_run_id": run_id,
        "_run_ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    row.update(lat)
    return row


CSV_FIELDS = [
    "id", "lang", "voice_name", "chars", "audio_s",
    "wer_pct", "cer_pct", "sub", "ins", "del",
    "trailing_del", "dur_expected_ratio", "truncated",
    "f0_semitone_std", "f0_mean_hz", "n_pauses", "speaking_rate_wps",
    "dnsmos_ovrl", "dnsmos_sig", "dnsmos_bak", "utmos",
    "detected_lang", "lufs", "peak_dbfs", "clipping_pct", "snr_db_est",
    "ttfa_p50_ms", "ttfa_p90_ms", "ttfa_iqr_ms", "total_p50_ms", "rtf_p50",
]


def id_set(arg):
    """Parse a comma-separated id/base_id list; empty string -> empty set."""
    return {x.strip() for x in arg.split(",") if x.strip()} if arg else set()


def wants_latency(item, selector):
    if selector == "all":
        return True
    if selector == "none":
        return False
    ids = id_set(selector)
    return item["id"] in ids or item.get("base_id") in ids


def write_outputs(out_dir, merged, manifest_order):
    """Write merged results in manifest order (extras, if any, appended)."""
    ordered_ids = [i for i in manifest_order if i in merged]
    ordered_ids += [i for i in merged if i not in manifest_order]
    rows = [merged[i] for i in ordered_ids]
    with open(out_dir / "results.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    with open(out_dir / "results.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    return len(rows)


async def main():
    ap = argparse.ArgumentParser(description="Batch reference-free TTS eval (incremental)")
    ap.add_argument("--manifest", default="manifest.jsonl")
    ap.add_argument("--out-dir", default="outputs")
    ap.add_argument("--trials", type=int, default=5, help="timed latency trials per item")
    ap.add_argument("--warmup", type=int, default=1, help="discarded warmup trials per item")
    ap.add_argument("--asr-model", default="small")
    ap.add_argument("--latency-ids", default="all",
                    help="'all' (default), 'none', or comma-separated ids/base_ids that get "
                         "latency trials. Others are scored quality-only (no latency calls).")
    ap.add_argument("--only", default="",
                    help="comma-separated ids/base_ids to process; everything else is left as-is. "
                         "Implies reprocessing of the named items.")
    ap.add_argument("--force", action="store_true",
                    help="reprocess (and re-bill) items even if already scored.")
    ap.add_argument("--prune", action="store_true",
                    help="drop result rows whose id is no longer in the manifest.")
    ap.add_argument("--dry-run", action="store_true",
                    help="print what would be processed and the cost estimate, then exit.")
    args = ap.parse_args()

    items = read_manifest(args.manifest)
    manifest_ids = [it["id"] for it in items]
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    results_path = out_dir / "results.json"
    existing = load_existing(results_path)

    only = id_set(args.only)

    # --- decide what to process ---
    def already_done(it):
        return it["id"] in existing and (out_dir / f"{it['id']}.wav").exists()

    to_process, skipped = [], []
    for it in items:
        if only:
            if it["id"] in only or it.get("base_id") in only:
                to_process.append(it)
            else:
                skipped.append(it)
        elif args.force or not already_done(it):
            to_process.append(it)
        else:
            skipped.append(it)

    # --- cost estimate for the to-process set only ---
    def calls_for(it):
        return 1 + (args.warmup + args.trials if wants_latency(it, args.latency_ids) else 0)
    est_credits = sum(len(it["text"]) * calls_for(it) for it in to_process)
    n_lat = sum(1 for it in to_process if wants_latency(it, args.latency_ids))

    # In --only mode, skipped items are "not selected" rather than "already scored";
    # label accurately either way.
    reason = "not selected" if only else "already scored"
    print(f"manifest: {len(items)} items | to process: {len(to_process)} "
          f"({n_lat} with latency) | skipping ({reason}): {len(skipped)}")
    print(f"est. cost for this run ≈ {est_credits} credits "
          f"(skipped items cost nothing)\n")

    stale = [i for i in existing if i not in manifest_ids]
    if stale:
        verb = "pruning" if args.prune else "keeping (use --prune to drop)"
        print(f"note: {len(stale)} result row(s) not in manifest — {verb}: "
              f"{', '.join(stale[:8])}{'...' if len(stale) > 8 else ''}\n")

    if args.dry_run:
        print("dry run — nothing synthesized.")
        return 0

    if not to_process:
        print("nothing to process. (Use --force to rescore, or --only <ids>.)")
        # still honor --prune on an otherwise no-op run
        if args.prune and stale:
            merged = {i: r for i, r in existing.items() if i in manifest_ids}
            n = write_outputs(out_dir, merged, manifest_ids)
            print(f"pruned; wrote {n} rows.")
        return 0

    print("loading models (Whisper + UTMOS + DNSMOS)...", flush=True)
    api_key = os.environ.get("GRADIUM_API_KEY")
    if not api_key:
        raise SystemExit("Set GRADIUM_API_KEY (run via: uv run --env-file .env python run_batch.py ...)")
    asr = load_asr(args.asr_model)
    utmos = load_utmos()
    dnsmos = load_dnsmos()

    run_id = uuid.uuid4().hex[:8]
    client = gradium.client.GradiumClient(api_key=api_key)

    # Start from prior results (optionally pruned), then overwrite processed ids.
    merged = {i: r for i, r in existing.items() if not (args.prune and i not in manifest_ids)}

    n_done = 0
    for it in to_process:
        do_lat = wants_latency(it, args.latency_ids)
        trials = args.trials if do_lat else 0
        try:
            row = await process_item(client, it, asr, utmos, dnsmos,
                                     trials, args.warmup, out_dir, run_id)
            merged[it["id"]] = row
            n_done += 1
            trunc_flag = " TRUNC" if row["truncated"] else ""
            ttfa = f"{row['ttfa_p50_ms']:6.1f}ms" if row["ttfa_p50_ms"] is not None else "   --  "
            print(f"  [{row['id']:14s}] {row['lang']}  WER {row['wer_pct']:5.1f}%{trunc_flag}  "
                  f"UTMOS {row['utmos']:.2f}  DNSMOS {row['dnsmos_ovrl']:.2f}  "
                  f"f0std {row['f0_semitone_std']:.1f}st  TTFA {ttfa}  "
                  f"RTF {row['rtf_p50'] if row['rtf_p50'] is not None else '  -- '}", flush=True)
            # Checkpoint every 10 items so a mid-run crash keeps completed work.
            if n_done % 10 == 0:
                write_outputs(out_dir, merged, manifest_ids)
        except Exception as exc:  # noqa: BLE001 - keep batch alive, log the failure
            print(f"  [{it['id']:14s}] FAILED -> {type(exc).__name__}: {exc}", flush=True)

    total = write_outputs(out_dir, merged, manifest_ids)
    print(f"\nprocessed {n_done} item(s) this run; results.json now holds {total} rows "
          f"({out_dir/'results.csv'} + results.json)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
