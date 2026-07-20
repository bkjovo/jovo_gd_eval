"""
export_site.py — join manifest metadata with scored metrics and publish to the web app.

Reads:
  manifest.jsonl        corpus definition (text, voice, difficulty, use_case, stress_category)
  outputs/results.json  scored metrics from run_batch.py
  outputs/<id>.wav      audio

Writes:
  ../web/public/data/clips.json   one record per clip, metrics grouped by taxonomy dimension
  ../web/public/clips/<id>.wav    audio served losslessly (raters judge D-AUD directly)

This is the only path between the harness and the site. Adding a clip = append a
manifest line, re-run run_batch.py, re-run this. Nothing in the web app is hand-edited.

Run:
    python export_site.py
    python export_site.py --web-dir ../web
"""

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


def read_manifest(path):
    with open(path, encoding="utf-8") as f:
        return {json.loads(line)["id"]: json.loads(line) for line in f if line.strip()}


def reference_words(row, text):
    """
    Reference word count, needed to micro-average WER across the corpus.

    Older result files predate the `ref_words` field, so fall back to a whitespace
    count of the source text. jiwer tokenises on whitespace after its transforms, so
    the two agree; verified against fr-1, where the count derivable from
    (sub+ins+del)/WER matches the whitespace count exactly.
    """
    if "ref_words" in row:
        return row["ref_words"]
    return len(text.split())


def group_metrics(row, text):
    """Regroup the flat results row by defect-taxonomy dimension (Table 1b)."""
    return {
        "int": {
            "wer_pct": row["wer_pct"],
            "cer_pct": row["cer_pct"],
            "ref_words": reference_words(row, text),
            "sub": row["sub"],
            "ins": row["ins"],
            "del": row["del"],
            "trailing_del": row["trailing_del"],
            "dur_expected_ratio": row["dur_expected_ratio"],
            "truncated": row["truncated"],
            "detected_lang": row["detected_lang"],
            "hypothesis": row.get("_hypothesis", ""),
        },
        "nat": {
            "utmos": row["utmos"],
            "f0_semitone_std": row["f0_semitone_std"],
            "f0_mean_hz": row["f0_mean_hz"],
            "n_pauses": row["n_pauses"],
            "speaking_rate_wps": row["speaking_rate_wps"],
        },
        "aud": {
            "dnsmos_ovrl": row["dnsmos_ovrl"],
            "dnsmos_sig": row["dnsmos_sig"],
            "dnsmos_bak": row["dnsmos_bak"],
            "lufs": row["lufs"],
            "peak_dbfs": row["peak_dbfs"],
            "clipping_pct": row["clipping_pct"],
            "snr_db_est": row["snr_db_est"],
        },
        "lat": {
            "ttfa_p50_ms": row["ttfa_p50_ms"],
            "ttfa_p90_ms": row["ttfa_p90_ms"],
            "ttfa_iqr_ms": row["ttfa_iqr_ms"],
            "total_p50_ms": row["total_p50_ms"],
            "rtf_p50": row["rtf_p50"],
            # With --trials 1 there is no dispersion; the UI must not rank on p90/IQR.
            "n_trials": len(row.get("_latency_trials", [])),
            # Raw measurements. A corpus-level p90 has to be computed over the pooled
            # trials; the mean of per-clip p90s is not a percentile of anything.
            "ttfa_trials_ms": [
                round(t["ttfa"] * 1000, 1) for t in row.get("_latency_trials", [])
            ],
        },
    }


def main():
    ap = argparse.ArgumentParser(description="Publish scored clips to the web app")
    ap.add_argument("--manifest", default="manifest.jsonl")
    ap.add_argument("--results", default="outputs/results.json")
    ap.add_argument("--out-dir", default="outputs")
    ap.add_argument("--web-dir", default="../web")
    args = ap.parse_args()

    manifest = read_manifest(args.manifest)
    with open(args.results, encoding="utf-8") as f:
        results = json.load(f)

    web = Path(args.web_dir)
    clips_dir = web / "public" / "clips"
    data_dir = web / "public" / "data"
    clips_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    out_dir = Path(args.out_dir)
    clips, skipped = [], []

    for row in results:
        cid = row["id"]
        meta = manifest.get(cid)
        if meta is None:
            skipped.append((cid, "not in manifest"))
            continue

        wav_src = out_dir / f"{cid}.wav"
        if not wav_src.exists():
            skipped.append((cid, "missing wav"))
            continue
        shutil.copy2(wav_src, clips_dir / f"{cid}.wav")

        clips.append({
            "id": cid,
            "lang": row["lang"],
            "text": meta["text"],
            "voice_name": row["voice_name"],
            "voice_id": row["voice_id"],
            "difficulty": meta.get("difficulty", "unknown"),
            "use_case": meta.get("use_case", "unknown"),
            "stress_category": meta.get("stress_category", "unknown"),
            "audio_url": f"/clips/{cid}.wav",
            "chars": row["chars"],
            "audio_s": row["audio_s"],
            "metrics": group_metrics(row, meta["text"]),
        })

    # Manifest rows that were never scored — surfaced so the corpus can't silently drift.
    unscored = [cid for cid in manifest if cid not in {c["id"] for c in clips}]

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "n_clips": len(clips),
        "languages": sorted({c["lang"] for c in clips}),
        "difficulties": sorted({c["difficulty"] for c in clips}),
        "use_cases": sorted({c["use_case"] for c in clips}),
        "stress_categories": sorted({c["stress_category"] for c in clips}),
        "unscored_manifest_ids": unscored,
        "clips": clips,
    }

    dest = data_dir / "clips.json"
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"wrote {dest} ({len(clips)} clips) and copied audio to {clips_dir}")
    print(f"  languages: {', '.join(payload['languages'])}")
    for cid, why in skipped:
        print(f"  SKIPPED {cid}: {why}")
    if unscored:
        print(f"  UNSCORED (in manifest, no results): {', '.join(unscored)}")


if __name__ == "__main__":
    main()
