"""Smoke test: verify gradium is importable and the API key authenticates."""
import asyncio
import os
import sys

import gradium


async def main() -> int:
    api_key = os.environ.get("GRADIUM_API_KEY")
    if not api_key:
        print("FAIL: GRADIUM_API_KEY not set (run via: uv run --env-file .env python smoke_test.py)")
        return 1

    print(f"gradium OK  | python {sys.version.split()[0]}  | key ...{api_key[-4:]}")

    client = gradium.GradiumClient(api_key=api_key)

    try:
        credits = await client.credits()
        print(f"credits()      -> {credits}")

        voices = await client.voice_list()
        count = len(voices) if hasattr(voices, "__len__") else "?"
        print(f"voice_list()   -> {count} entr{'y' if count == 1 else 'ies'}")
    except Exception as exc:  # noqa: BLE001 - smoke test surfaces any failure
        print(f"FAIL: API call errored -> {type(exc).__name__}: {exc}")
        return 1

    print("PASS: gradium reachable and authenticated")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
