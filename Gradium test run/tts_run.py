"""
tts_run.py — a real TTS synthesis + inspection run against the Gradium API.

Generates an expressive narration clip, saves it as a WAV you can actually
listen to, and prints the eval-relevant signal: request_id, sample rate,
word-level timestamps, audio duration, and the credit cost of the call.

Buffered (client.tts) rather than streaming: for a qualitative "does it sound
right + what did it cost" check, waiting for the full result is the point.
Latency/TTFA lives in gradium_ttfa.py.

Run (matches your .env setup):
    uv run --env-file .env python tts_run.py
    uv run --env-file .env python tts_run.py \
        --voice 1VAVLmmbQFDw7TMn --lang fr --out narrateur_fr.wav \
        --text "Il etait une fois, au bord du monde, un horloger qui avait oublie comment dormir."

Every gradium client call is an async coroutine and must be awaited.
"""

import argparse
import asyncio
import io
import json
import os
import re
import wave

import gradium

# A storyteller voice (Abigail, en-us) reading an expressive opening with a
# dramatic pause. The <break> tag must be space-padded on both sides.
DEFAULT_VOICE = "KRo-uwfno-KcEgBM"
DEFAULT_TEXT = (
    "Once upon a time, in a village at the edge of the world, there lived a "
    "clockmaker who had forgotten how to sleep. <break time=\"0.8s\" /> "
    "Every night, he wound a thousand tiny gears, listening for the one sound "
    "he could never quite hear."
)


def spoken_chars(text):
    """Approx billable characters: strip control tags (<break/>, <flush>)."""
    return len(re.sub(r"<[^>]+>", "", text))


async def fetch_credits(client):
    """Return the raw usage dict, or None if the method path differs."""
    try:
        return await gradium.usages.get(client)
    except Exception as e:  # don't let a usage-schema quirk kill the run
        print(f"(couldn't read credits: {e})")
        return None


async def main():
    ap = argparse.ArgumentParser(description="Real Gradium TTS run")
    ap.add_argument("--voice", default=DEFAULT_VOICE)
    ap.add_argument("--text", default=DEFAULT_TEXT)
    ap.add_argument("--lang", default="en",
                    help="rewrite-rule language: en|fr|de|es|pt (normalizes numbers/dates)")
    ap.add_argument("--temp", type=float, default=None, help="0-1.4, default model 0.7")
    ap.add_argument("--out", default="narrateur_en.wav")
    ap.add_argument("--api-key", default=None)
    args = ap.parse_args()

    api_key = args.api_key or os.environ.get("GRADIUM_API_KEY")
    if not api_key:
        raise SystemExit("Set GRADIUM_API_KEY (or use --env-file .env / --api-key)")

    client = gradium.client.GradiumClient(api_key=api_key)

    json_config = {"rewrite_rules": args.lang}
    if args.temp is not None:
        json_config["temp"] = args.temp

    est_cost = spoken_chars(args.text)
    print(f"voice={args.voice}  lang={args.lang}  chars≈{est_cost} (≈ credits)\n")

    before = await fetch_credits(client)

    result = await client.tts(
        setup={
            "model_name": "default",
            "voice_id": args.voice,
            "output_format": "wav",
            "json_config": json_config,
        },
        text=args.text,
    )

    with open(args.out, "wb") as f:
        f.write(result.raw_data)

    # Duration from the actual PCM byte count. The API streams WAV with a
    # placeholder data-chunk size (INT32_MAX), so w.getnframes() and the
    # header's data-size field are both unreliable — measure real bytes.
    with wave.open(io.BytesIO(result.raw_data), "rb") as w:
        framerate = w.getframerate()
        block_align = w.getnchannels() * w.getsampwidth()
    data_idx = result.raw_data.find(b"data")
    pcm_bytes = len(result.raw_data) - (data_idx + 8) if data_idx != -1 else 0
    duration_s = pcm_bytes / (framerate * block_align) if block_align else 0.0

    after = await fetch_credits(client)

    print(f"saved:       {args.out}")
    print(f"request_id:  {result.request_id}")
    print(f"sample_rate: {result.sample_rate} Hz")
    print(f"duration:    {duration_s:.2f} s")

    # Word-level timestamps — the alignment signal an eval pipeline leans on.
    print("\nword timestamps (first 12):")
    for item in result.text_with_timestamps[:12]:
        print(f"  {item.start_s:6.2f}–{item.stop_s:6.2f}s   {item.text}")

    # Real credit delta if the usage dict exposed a comparable number.
    if before and after:
        print("\ncredits before/after (raw):")
        print("  before:", json.dumps(before))
        print("  after: ", json.dumps(after))
    print(f"\nexpected cost this call ≈ {est_cost} credits (1 credit = 1 char)")
    print(f"\n▶ play it:  afplay {args.out}   (macOS)   |   open {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
