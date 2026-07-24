"""
retime_latency.py — re-measure latency for the shipped corpus, without touching audio.

Exists because the original run timed the WAV header, not the audio (see
trial_stream in gradium_ttfa.py). This re-times every clip with the corrected
stopwatch and patches ONLY the lat block in web/public/data/clips.json; the audio,
transcripts and quality metrics are untouched, so existing reviews stay valid.

Runs are resumable: each measured clip is appended to a progress file, and the
clips.json patch is a separate explicit step.

    uv run --env-file .env python retime_latency.py --ids health-01-en,bank-01-es
    uv run --env-file .env python retime_latency.py --all --skip-done
    uv run --env-file .env python retime_latency.py --apply

Calls are sequential on one connection: parallel trials would queue on the wire
and contaminate each other's timing. WARNING: billable, trials x chars per clip.
"""

import argparse
import asyncio
import json
import os
import time

import gradium

from gradium_ttfa import trial_stream, summarize

CLIPS = os.path.join(os.path.dirname(__file__), "..", "web", "public", "data", "clips.json")
PROGRESS = os.path.join(os.path.dirname(__file__), "retime_progress.json")


def load_progress():
    try:
        with open(PROGRESS) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_progress(p):
    with open(PROGRESS, "w") as f:
        json.dump(p, f, indent=1)


async def measure(clips, trials, warmup_per_voice):
    key = os.environ.get("GRADIUM_API_KEY")
    if not key:
        raise SystemExit("Set GRADIUM_API_KEY")
    client = gradium.client.GradiumClient(api_key=key)
    progress = load_progress()

    # Run-level warmup per distinct voice, so no measured trial pays cold-start.
    for voice in dict.fromkeys(c["voice_id"] for c in clips):
        setup = {"model_name": "default", "voice_id": voice, "output_format": "wav", "json_config": {}}
        for _ in range(warmup_per_voice):
            await trial_stream(client, setup, "Hello.")

    t_start = time.time()
    for i, c in enumerate(clips):
        setup = {"model_name": "default", "voice_id": c["voice_id"], "output_format": "wav", "json_config": {}}
        rows = []
        for _ in range(trials):
            for attempt in (1, 2):
                try:
                    rows.append(await trial_stream(client, setup, c["text"]))
                    break
                except Exception as exc:  # noqa: BLE001 - one retry, then record the failure
                    if attempt == 2:
                        print(f"  {c['id']}: trial failed twice: {type(exc).__name__}: {exc}")
        if rows:
            progress[c["id"]] = {"trials": rows, "measured_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
            save_progress(progress)
        ttfas = [round(r["ttfa"] * 1000) for r in rows if r["ttfa"] is not None]
        heads = [round(r["ttfa_header"] * 1000) for r in rows if r["ttfa_header"] is not None]
        print(f"[{i+1}/{len(clips)}] {c['id']:16} ttfa {ttfas} ms  header {heads} ms", flush=True)
    print(f"done in {time.time()-t_start:.0f}s; progress -> {PROGRESS}")


def apply_progress():
    progress = load_progress()
    with open(CLIPS) as f:
        data = json.load(f)
    patched = 0
    for c in data["clips"]:
        entry = progress.get(c["id"])
        if not entry:
            continue
        rows = [r for r in entry["trials"] if r.get("ttfa") is not None]
        if not rows:
            continue
        ttfa = summarize([r["ttfa"] for r in rows])
        total = summarize([r["total"] for r in rows])
        rtf = summarize([r["rtf"] for r in rows])
        c["metrics"]["lat"] = {
            "ttfa_p50_ms": round(ttfa["p50"] * 1000, 1),
            "ttfa_p90_ms": round(ttfa["p90"] * 1000, 1),
            "ttfa_iqr_ms": round(ttfa["iqr"] * 1000, 1),
            "total_p50_ms": round(total["p50"] * 1000, 1),
            "rtf_p50": round(rtf["p50"], 3),
            "n_trials": len(rows),
            "ttfa_trials_ms": [round(r["ttfa"] * 1000, 1) for r in rows],
        }
        patched += 1
    backup = CLIPS + ".bak"
    os.replace(CLIPS, backup)
    with open(CLIPS, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"patched {patched}/{len(data['clips'])} clips; backup at {backup}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default=None, help="comma-separated clip ids")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--skip-done", action="store_true", help="skip clips already in the progress file")
    ap.add_argument("--trials", type=int, default=3)
    ap.add_argument("--warmup", type=int, default=2)
    ap.add_argument("--apply", action="store_true", help="patch clips.json from the progress file")
    args = ap.parse_args()

    if args.apply:
        apply_progress()
        return

    with open(CLIPS) as f:
        clips = json.load(f)["clips"]
    if args.ids:
        want = set(args.ids.split(","))
        clips = [c for c in clips if c["id"] in want]
    elif not args.all:
        raise SystemExit("pass --ids, --all, or --apply")
    if args.skip_done:
        done = set(load_progress())
        clips = [c for c in clips if c["id"] not in done]
    est = sum(len(c["text"]) for c in clips) * args.trials
    print(f"{len(clips)} clips x {args.trials} trials ≈ {est} credits")
    asyncio.run(measure(clips, args.trials, args.warmup))


if __name__ == "__main__":
    main()
