# Harness

Python pipeline: corpus → synthesis → objective scoring → site export.

## Setup

```bash
uv sync
cp .env.example .env   # add your GRADIUM_API_KEY
```

## Pipeline

| Script | Role |
|---|---|
| `corpus/build_corpus.py` | Writes `corpus/manifest_125.jsonl` — the corpus definition ([design notes](corpus/README.md)) |
| `run_batch.py` | Synthesis + scoring per clip, incremental; writes `corpus/outputs/` |
| `evaluate.py` | Metric implementations: WER/CER with normalization, UTMOS, DNSMOS, prosody, truncation |
| `gradium_ttfa.py` | Streamed time-to-first-audio measurement |
| `export_site.py` | Joins manifest + results into `web/public/data/clips.json`, copies audio |

```bash
uv run --env-file .env python run_batch.py
uv run python export_site.py
```

Scoring runs locally: faster-whisper `large-v3`, UTMOS, DNSMOS P.835, librosa,
pyloudnorm. The first run downloads model weights. Since `corpus/outputs/` is
committed, scoring and export can be re-run without an API key.

## Utilities

| Script | Role |
|---|---|
| `smoke_test.py` | Verifies the API key authenticates |
| `tts_run.py` | Synthesizes one clip; prints duration, timestamps, and credit cost |
| `corpus/asr_model_test.py` | The whisper `small` vs `large-v3` controlled comparison |
