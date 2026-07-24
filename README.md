# Gradium TTS evaluation

An evaluation tool for Gradium's text-to-speech model: a Python harness that
synthesizes and scores a stress corpus, and a web app for blind human annotation,
per-vertical reporting, and the gap between the two.

**Live:** https://jovo-gr-eval.vercel.app

## Layout

| Path | Contents |
|---|---|
| [`harness/`](harness/) | Corpus generation, synthesis, objective scoring, site export |
| [`web/`](web/) | Next.js site: annotation flow, dashboards, methodology, GTM |

## Pipeline

1. `harness/corpus/build_corpus.py` writes the corpus manifest: 145 lines across
   5 languages, 4 use cases, and 22 stress categories (codes, currency, proper
   nouns, homographs, code-switching).
2. `harness/run_batch.py` synthesizes each line through the Gradium API — one
   buffered call for audio, one streamed call for latency — and scores it:
   WER/CER through whisper large-v3 with documented normalization, UTMOS,
   DNSMOS, and prosody statistics.
3. `harness/export_site.py` joins manifest to metrics and writes
   `web/public/data/clips.json` plus the audio under `web/public/clips/`.
4. The site reads that JSON and nothing else. Human annotations are collected
   blind (no machine scores shown to raters) and stored in Supabase.

The scored outputs are committed (`harness/corpus/outputs/`), so scoring and the
export can be re-run against the committed audio without an API key.

Commands and environment variables: [`harness/README.md`](harness/README.md) and
[`web/README.md`](web/README.md).
