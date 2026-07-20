# Gradium Case Study: state and next steps

Last updated 2026-07-20.

**Deliverable:** a working evaluation tool at a public URL.
**Their three weighted criteria:** (1) UI/UX for collecting feedback, (2) the evaluation
logic, (3) how it becomes actionable for research. Plus a GTM story at the onsite.

## The concept

**Soundcheck measures the gap between automated metrics and human ears.**

Reviewers annotate blind, with no machine score in the payload sent to the review page.
Disagreement is reported as its own finding, and objective scores are never altered by
human input. The output is not "Gradium scores 4.2", it is "here is where UTMOS and
DNSMOS disagree with listeners", which is the artifact a research team can act on.

The Python harness is the engine. The website is the bridge.

---

## Where things stand

### Done

**Harness** (`Gradium test run/`)
- `run_batch.py` scores a manifest; now also emits `ref_words` for micro-averaging.
- `export_site.py` (new) joins manifest metadata to metrics and publishes to the web app.
  Exports `ref_words` and raw per-trial TTFA values.
- `manifest.jsonl` carries `difficulty`, `use_case`, `stress_category` on all 7 clips.
- `voices.json` (new) records the voice roster including the new Portuguese pick.

**Site** (`web/`) — Next.js 16, React 19, Tailwind 4, shadcn/ui. Builds clean.

| Route | State |
|---|---|
| `/` | Executive summary: Ready-to-ship verdict, objective tiles, derived action items, per-language table, coverage |
| `/rate` | Blind annotation flow (nav label "Annotate!") |
| `/samples` | Every clip with audio, source text, ASR transcript, word-level diff |
| `/metrics` | Metrics Deep Dive with language / difficulty / use-case cuts |
| `/method` | Methodology, mapping table, aggregation rules, limitations |
| `/gtm` | Placeholder, scaffolded |

**Supabase** — `web/supabase/schema.sql` written and ready to paste. Not yet run; no
project exists. Ratings currently fall back to an in-process store and the summary page
says so in an amber banner.

### Decisions locked

- No live generation. Precomputed clips only; no API key in production.
- Audio served lossless. Reviewers judge audio quality directly, so transcoding would
  contaminate the human-vs-machine comparison.
- Reviewers give one scalar (1 to 5 overall) plus grouped defect tags. The explicit
  ship/no-ship question was removed; the blind-spot rule now triggers on mean score
  below `HUMAN_REJECT_BELOW` (3.0) in `taxonomy.ts`.
- Action items are derived from thresholds, never authored.
- Latency reported as p90, pooled across trials. WER micro-averaged.
- No em dashes anywhere in site copy.

---

## Next session, in order

1. ~~Put this under version control.~~ Done. Single repo at the Gradium root, 86 files.
   `gradbot/`, `.venv/`, `node_modules/` and every `.env` are excluded. Note that
   `create-next-app` had made its own repo inside `web/`, which meant the outer repo
   was tracking an empty gitlink instead of the site source; that nested `.git` was
   moved to the session scratchpad and can be deleted. Commit identity is set
   repo-locally to Joseph Vosburgh <vosburgh.joseph@gmail.com>; change it with
   `git config user.name "..."` then `git commit --amend --reset-author` if wrong.
2. **Create the Supabase project**, run `web/supabase/schema.sql`, put the two values in
   `web/.env.local`. Then ask Claude to submit a rating locally against real Supabase to
   confirm the write path before deploying. The `on_conflict` upsert has never been
   exercised against actual Postgres.
3. **Deploy to Vercel.** `cd web && npx vercel && npx vercel --prod`. Set the two env
   vars in Project Settings, redeploy, then verify by submitting a rating on the
   deployed URL and confirming the row lands in Supabase. This is the case study's one
   hard requirement.
4. **Seed reviews** across the corpus, non-English first, so the dashboard is not empty
   when graders open it.
5. **Build the 20x5 parallel corpus** (see below). Costs credits; needs a decision on
   trials first.
6. **Write the GTM page** properly. There is a dedicated 45-minute session on it.

## Corpus work, when ready to spend credits

- 20 texts as **parallel translations** across en/es/fr/de/pt, so language is a clean
  variable. Roughly 15 parallel plus 5 language-specific (homographs and decimal
  separators do not translate).
- Stress categories: numbers and currency, acronyms, homographs, loanwords, long-form
  truncation bait, very short, punctuation-heavy, code-switching.
- **Re-pick persona-matched voices first.** Current roster is not matched: Jules (fr) is
  "Enthusiastic, Expressive" while es/de are "Helpful, Attentive". An expressive persona
  inflates `f0_semitone_std`, which is the monotone detector. See `voices.json`.
- **Latency trials.** p90 needs a distribution. `--trials 1` collapses p90 to a single
  measurement and makes the tail statistic decorative. Suggested compromise: 5 trials on
  a stratified subset of ~15 clips, skip latency for the rest. Keeps a real p90, still
  cuts most of the cost.
- `run_batch.py` is **not incremental**. It reprocesses every manifest row and overwrites
  results wholesale. Fix before adding clips, or adding one row re-bills the whole corpus.

## Known gotchas

- `lib/clips.ts` must stay free of Node built-ins; client components import it. The
  filesystem loader lives in `lib/load-clips.ts`.
- The in-memory ratings store hangs off `globalThis`, or route handlers and server
  components get separate copies.
- shadcn's `Button` here has no `asChild`.
- Node is at `/opt/homebrew/bin` and may not be on a fresh shell's PATH.
- Whisper accuracy varies by language, so cross-language WER is confounded. Latency is
  the only figure that compares cleanly across languages.
