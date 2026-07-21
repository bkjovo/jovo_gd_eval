"""
run_batch.py — batch reference-free TTS eval over a JSONL manifest.

For each manifest item:
  * QUALITY  — one buffered synthesis (client.tts) saved as a listenable WAV,
               then signal sanity + WER/CER (ASR vs text) + UTMOS + DNSMOS.
  * LATENCY  — N timed streaming trials (client.tts_stream) giving client-side
               TTFA / total / RTF. Skipped entirely for items not in the latency
               selection (trials=0). Warmup is RUN-LEVEL, not per-clip: a few
               discarded calls per distinct voice before any timing, which is where
               the real cold start lives (connection setup + voice model load).
               Per-clip warmup would cost ~145x more and, by synthesizing each
               clip's text twice, risks timing a server-side cache hit.

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
    # recommended v2 run: quality + one timed latency call on every clip,
    # with a single run-level warmup per voice
    uv run --env-file .env python run_batch.py --manifest corpus/manifest_125.jsonl \
        --out-dir corpus/outputs --trials 1 --latency-ids all
    # add or fix a few clips later (only these are billed):
    uv run --env-file .env python run_batch.py --manifest corpus/manifest_125.jsonl \
        --out-dir corpus/outputs --only bank-03-fr,bank-03-de

WARNING: billable. Per processed item = 1 quality + trials latency calls, each
charged over the item's character count, plus a few credits of run-level warmup.
Skipped items cost nothing.
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


async def warm_up(client, items, per_voice, warm_text="Hello."):
    """
    Run-level warmup: a few discarded calls per DISTINCT VOICE before any timing.

    This absorbs the things that are actually cold — connection/TLS setup and
    per-voice model loading — both of which are one-time, not per-clip. Warming
    every clip would pay ~145x for a 5x cost, and because it would synthesize each
    clip's exact text twice, any server-side (text, voice) caching would turn the
    timed call into a cache hit and understate TTFA. Every clip's text is unique, so
    a novel-text call is also the realistic thing to measure.
    """
    if per_voice <= 0:
        return 0
    seen, chars = {}, 0
    for it in items:
        seen.setdefault(it["voice_id"], it["lang"])
    for voice_id, lang in seen.items():
        setup = {
            "model_name": "default",
            "voice_id": voice_id,
            "output_format": "wav",
            "json_config": {"rewrite_rules": lang},
        }
        for _ in range(per_voice):
            try:
                await trial_stream(client, setup, warm_text)
                chars += len(warm_text)
            except Exception as exc:  # noqa: BLE001 - a failed warmup must not kill the run
                print(f"  warmup failed for voice {voice_id}: {type(exc).__name__}: {exc}")
    print(f"  warmed {len(seen)} voice(s) x {per_voice} call(s) ≈ {chars} credits", flush=True)
    return chars


def score_wav(wav_path, item, asr, utmos, dnsmos, run_id):
    """
    All metrics computable from an existing WAV. No API calls, so this is what the
    offline --rescore path uses to re-apply improved scoring for zero credits.
    """
    text = item["text"]
    wav, sr = load_mono(str(wav_path))
    sig = signal_sanity(wav, sr)
    intel = intelligibility(str(wav_path), text, asr, language=item["lang"])
    trunc = truncation_check(sig["duration_s"], intel["ref_words"],
                             intel["trailing_deletions"], sig["trail_silence_s"])
    pros = prosody(wav, sr, n_words=intel["ref_words"])
    mos = predicted_mos(wav, sr, utmos)
    aud = audio_quality(wav, sr, dnsmos)

    row = {
        "id": item["id"],
        "lang": item["lang"],
        "voice_name": item.get("voice_name", ""),
        "voice_id": item["voice_id"],
        "chars": len(text),
        "audio_s": round(sig["duration_s"], 3),
        "wer_pct": round(intel["wer"] * 100, 2),
        # Unnormalized WER: how the figure looks before reconciling the recogniser's
        # writing conventions. A large raw-vs-normalized gap means the item's score was
        # dominated by transcription formatting, not speech.
        "wer_raw_pct": round(intel["wer_raw"] * 100, 2),
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
    return row


async def process_item(client, item, asr, utmos, dnsmos, trials, out_dir, run_id):
    """Synthesize (billable), score, then optionally time N latency trials."""
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
    row = score_wav(wav_path, item, asr, utmos, dnsmos, run_id)

    # --- LATENCY: N timed trials (warmup is run-level, see warm_up()) ---
    if trials > 0:
        latency_trials = [await trial_stream(client, setup, text) for _ in range(trials)]
        ttfa = summarize([t["ttfa"] for t in latency_trials])
        total = summarize([t["total"] for t in latency_trials])
        rtf = summarize([t["rtf"] for t in latency_trials])
        row.update({
            "ttfa_p50_ms": round(ttfa["p50"] * 1000, 1),
            "ttfa_p90_ms": round(ttfa["p90"] * 1000, 1),
            "ttfa_iqr_ms": round(ttfa["iqr"] * 1000, 1),
            "total_p50_ms": round(total["p50"] * 1000, 1),
            "rtf_p50": round(rtf["p50"], 3),
            "_latency_trials": latency_trials,
            "_ttfa": ttfa, "_total": total, "_rtf": rtf,
        })
    else:
        row.update(dict(_EMPTY_LATENCY))
    return row


LATENCY_KEYS = list(_EMPTY_LATENCY.keys())


def rescore_existing(items, existing, asr, utmos, dnsmos, out_dir, run_id):
    """
    Re-apply scoring to WAVs already on disk. Zero API calls, zero credits.

    Latency cannot be recomputed offline, so prior latency measurements are carried
    forward verbatim from the existing results (along with the _run_id that produced
    them, so the provenance of a timing is never misattributed to this rescore).
    """
    rescored, missing = {}, []
    for it in items:
        wav_path = out_dir / f"{it['id']}.wav"
        if not wav_path.exists():
            missing.append(it["id"])
            continue
        row = score_wav(wav_path, it, asr, utmos, dnsmos, run_id)
        prior = existing.get(it["id"], {})
        for k in LATENCY_KEYS:
            row[k] = prior.get(k, _EMPTY_LATENCY[k])
        # Timings belong to the run that measured them, not to this rescore.
        row["_run_id"] = prior.get("_run_id", run_id)
        row["_rescored_ts"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        rescored[it["id"]] = row
    return rescored, missing


CSV_FIELDS = [
    "id", "lang", "voice_name", "chars", "audio_s",
    "wer_pct", "wer_raw_pct", "cer_pct", "sub", "ins", "del",
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
    ap.add_argument("--warmup-per-voice", type=int, default=1,
                    help="discarded warmup calls per DISTINCT VOICE at the start of the run "
                         "(not per item). Absorbs connection + per-voice model load; costs a "
                         "handful of credits. 0 disables.")
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
    ap.add_argument("--rescore", action="store_true",
                    help="re-apply scoring to WAVs already on disk. NO API CALLS, NO CREDITS. "
                         "Prior latency measurements are carried forward unchanged. Use after "
                         "changing metrics or normalization.")
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

    # --- OFFLINE RESCORE: no synthesis, no latency, no credits ---
    if args.rescore:
        targets = [it for it in items
                   if not only or it["id"] in only or it.get("base_id") in only]
        print(f"RESCORE: {len(targets)} item(s) from existing audio in {out_dir} "
              f"— no API calls, 0 credits\n")
        if args.dry_run:
            print("dry run — nothing scored.")
            return 0
        print("loading models (Whisper + UTMOS + DNSMOS)...", flush=True)
        asr, utmos, dnsmos = load_asr(args.asr_model), load_utmos(), load_dnsmos()
        run_id = uuid.uuid4().hex[:8]
        rescored, missing = rescore_existing(targets, existing, asr, utmos, dnsmos,
                                             out_dir, run_id)
        merged = dict(existing)
        merged.update(rescored)
        if args.prune:
            merged = {i: r for i, r in merged.items() if i in manifest_ids}
        n = write_outputs(out_dir, merged, manifest_ids)
        print(f"rescored {len(rescored)} item(s); results.json now holds {n} rows")
        if missing:
            print(f"  no audio on disk for {len(missing)}: "
                  f"{', '.join(missing[:8])}{'...' if len(missing) > 8 else ''}")
        return 0

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
        return 1 + (args.trials if wants_latency(it, args.latency_ids) else 0)
    est_credits = sum(len(it["text"]) * calls_for(it) for it in to_process)
    n_lat = sum(1 for it in to_process if wants_latency(it, args.latency_ids))
    # Run-level warmup: distinct voices x calls x a short throwaway string.
    n_voices = len({it["voice_id"] for it in to_process}) if n_lat else 0
    est_warmup = n_voices * max(0, args.warmup_per_voice) * len("Hello.")
    est_credits += est_warmup

    # In --only mode, skipped items are "not selected" rather than "already scored";
    # label accurately either way.
    reason = "not selected" if only else "already scored"
    print(f"manifest: {len(items)} items | to process: {len(to_process)} "
          f"({n_lat} with latency) | skipping ({reason}): {len(skipped)}")
    warm_note = (f", incl. {est_warmup} for run-level warmup of {n_voices} voice(s)"
                 if est_warmup else "")
    print(f"est. cost for this run ≈ {est_credits} credits "
          f"(skipped items cost nothing{warm_note})\n")

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

    # Warm once per voice before any timing, so the first timed clip is not paying
    # for connection setup or a cold voice model.
    if n_lat:
        lat_items = [it for it in to_process if wants_latency(it, args.latency_ids)]
        await warm_up(client, lat_items, args.warmup_per_voice)

    # Start from prior results (optionally pruned), then overwrite processed ids.
    merged = {i: r for i, r in existing.items() if not (args.prune and i not in manifest_ids)}

    n_done = 0
    for it in to_process:
        do_lat = wants_latency(it, args.latency_ids)
        trials = args.trials if do_lat else 0
        try:
            row = await process_item(client, it, asr, utmos, dnsmos,
                                     trials, out_dir, run_id)
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
