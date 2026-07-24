"""
gradium_ttfa.py — client-side latency harness for Gradium TTS.

Measures the latency a *client actually experiences*, end to end, with a
monotonic wall clock (time.perf_counter). The Gradium API returns no timing of
its own, and even if it did, server-reported time excludes network, TLS, and
queueing — it under-counts real delay. So every number here is measured at the
client, from just before the request until bytes actually arrive.

Metrics:
  TTFA   time-to-first-audio: request start -> first PCM chunk. The WAV header
         the server sends on request-accept is a preamble, not audio, and is
         excluded (timing it measures the network round trip, ~80ms, not the
         model, ~190ms server-side). The responsiveness number a user feels.
         Requires the streaming path.
  total  request start -> last audio byte received.
  RTF    real-time factor = total / audio_duration. <1 = faster than real time.

Run (needs the API key -> use --env-file):
    uv run --env-file .env python gradium_ttfa.py                 # 3 trials
    uv run --env-file .env python gradium_ttfa.py --trials 10

WARNING: every trial is a billable TTS call (~1 credit/char). A warmup trial
runs first (not counted) to exclude cold-connection setup; use --warmup 0 to
include cold start in the stats.
"""

import argparse
import asyncio
import os
import statistics
import time

import gradium

DEFAULT_VOICE = "KRo-uwfno-KcEgBM"
DEFAULT_TEXT = "The quick brown fox jumps over the lazy dog near the river."


def audio_duration_s(raw, sample_rate, sampwidth=2, channels=1):
    """Duration from real PCM byte count (WAV header size is a stream placeholder)."""
    idx = raw.find(b"data")
    pcm = len(raw) - (idx + 8) if 0 <= idx < 1024 else len(raw)
    denom = sample_rate * sampwidth * channels
    return pcm / denom if denom else 0.0


async def trial_stream(client, setup, text):
    t0 = time.perf_counter()
    stream = await client.tts_stream(setup=setup, text=text)
    ttfa = None
    ttfa_header = None
    chunks = []
    async for chunk in stream.iter_bytes():
        if ttfa is None:
            # The server sends the 44-byte WAV header ("RIFF....") immediately on
            # accepting the request, BEFORE any audio has been synthesized. Timing
            # that chunk measures one network round trip, not the model: measured
            # 2026-07-23, the header arrived at ~76-92ms while the first PCM chunk
            # (7,680 B) arrived at ~254ms, against a server-reported first-buffer
            # time of ~190ms. TTFA starts at the first chunk that is actual audio.
            if chunk[:4] == b"RIFF" and len(chunk) <= 100:
                ttfa_header = time.perf_counter() - t0
            else:
                ttfa = time.perf_counter() - t0
        chunks.append(chunk)
    total = time.perf_counter() - t0
    raw = b"".join(chunks)
    sr = stream.sample_rate or 48000
    audio_s = audio_duration_s(raw, sr)
    return {
        "ttfa": ttfa,
        # Header arrival ≈ one network round trip. Kept for diagnostics: this is the
        # quantity the pre-2026-07-23 harness mistakenly reported as TTFA.
        "ttfa_header": ttfa_header,
        "total": total,
        "audio_s": audio_s,
        "rtf": total / audio_s if audio_s else float("nan"),
        "request_id": stream.request_id,
    }


def _pct(vals, q):
    """Linear-interpolated percentile (numpy-style) on a pre-sorted list."""
    if len(vals) == 1:
        return vals[0]
    idx = q * (len(vals) - 1)
    lo = int(idx)
    hi = min(lo + 1, len(vals) - 1)
    return vals[lo] + (vals[hi] - vals[lo]) * (idx - lo)


def summarize(values):
    """p50 / p25 / p75 / IQR / p90 / min / max for a list of floats.

    IQR (p75 - p25) is the tail-consistency metric: small IQR = predictable
    latency, large IQR = jittery tail even if the median looks fine.
    """
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    p25, p75 = _pct(vals, 0.25), _pct(vals, 0.75)
    return {
        "p50": statistics.median(vals),
        "p25": p25,
        "p75": p75,
        "iqr": p75 - p25,
        "p90": _pct(vals, 0.90),
        "min": vals[0],
        "max": vals[-1],
    }


async def main():
    ap = argparse.ArgumentParser(description="Client-side latency harness for Gradium TTS")
    ap.add_argument("--trials", type=int, default=3)
    ap.add_argument("--warmup", type=int, default=1, help="uncounted warmup trials (excludes cold start)")
    ap.add_argument("--voice", default=DEFAULT_VOICE)
    ap.add_argument("--text", default=DEFAULT_TEXT)
    ap.add_argument("--lang", default="en")
    ap.add_argument("--api-key", default=None)
    args = ap.parse_args()

    api_key = args.api_key or os.environ.get("GRADIUM_API_KEY")
    if not api_key:
        raise SystemExit("Set GRADIUM_API_KEY (run via: uv run --env-file .env python gradium_ttfa.py)")

    client = gradium.client.GradiumClient(api_key=api_key)
    setup = {
        "model_name": "default",
        "voice_id": args.voice,
        "output_format": "wav",
        "json_config": {"rewrite_rules": args.lang},
    }
    est_credits = (args.warmup + args.trials) * len(args.text)
    print(f"mode: streaming (client.tts_stream)  | warmup={args.warmup} trials={args.trials}")
    print(f"text: {len(args.text)} chars  | est. cost ≈ {est_credits} credits\n")

    for _ in range(args.warmup):
        await trial_stream(client, setup, args.text)  # discard cold-start / connection setup

    results = []
    for i in range(args.trials):
        r = await trial_stream(client, setup, args.text)
        results.append(r)
        ttfa = f"{r['ttfa']*1000:7.0f}ms" if r["ttfa"] is not None else "    n/a"
        print(f"  trial {i+1:2d}  TTFA {ttfa}   total {r['total']*1000:7.0f}ms"
              f"   audio {r['audio_s']:5.2f}s   RTF {r['rtf']:.3f}   [{r['request_id']}]")

    print("\n== summary (p50 / p90 / IQR / min / max) ==")
    for key, label, scale, unit in [("ttfa", "TTFA ", 1000.0, "ms"),
                                     ("total", "total", 1000.0, "ms"),
                                     ("rtf", "RTF  ", 1.0, "")]:
        s = summarize([r[key] for r in results])
        if s is None:
            print(f"  {label}  n/a")
        else:
            print(f"  {label}  p50 {s['p50']*scale:8.2f}{unit}   p90 {s['p90']*scale:8.2f}{unit}"
                  f"   IQR {s['iqr']*scale:8.2f}{unit}"
                  f"   min {s['min']*scale:8.2f}{unit}   max {s['max']*scale:8.2f}{unit}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
