# Soundcheck

Evaluation tool for Gradium TTS. Objective defect metrics are computed offline by the
harness in `../Gradium test run`; this app presents them, collects structured human
review, and reports where the two disagree.

- `/` executive summary: objective metrics, plus action items derived from thresholds
- `/rate` blind review tool
- `/metrics` deep dive with language / difficulty / use-case cuts
- `/method` methodology, including the subjective→objective mapping
- `/gtm` placeholder

## Local development

```bash
npm install
npm run dev
```

Runs without any backing service. Ratings fall back to an in-process store, and the
summary page shows an amber banner saying so. That state is never silent.

## Supabase setup

Ratings need a database to survive a serverless cold start. Without one the deployed
site still works, but every rating is lost.

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Dashboard → **SQL Editor** → **New query** → paste [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   Idempotent, so re-running is safe.
3. Grab credentials:
   - **Project Settings → Data API → Project URL** → `SUPABASE_URL`
   - **Project Settings → API Keys → `service_role`** → `SUPABASE_SERVICE_ROLE_KEY`
4. Locally: `cp .env.example .env.local` and fill both in. Restart `npm run dev`.
5. Verify: the amber "not being persisted" banner on `/` should be gone.

### Why the service-role key

Reads and writes both go through `/api/ratings` on the server. The table has RLS
enabled with **no policies**, so the anon key can do nothing at all; the service role
bypasses RLS. That keeps the table closed even if a key leaks, and means there is no
RLS policy to misconfigure.

Neither variable uses the `NEXT_PUBLIC_` prefix. Adding it would ship the key to every
visitor.

## Deploying to Vercel

```bash
npx vercel          # first run: links the project
npx vercel --prod
```

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in **Project Settings → Environment
Variables** (Production scope), then redeploy so they take effect.

**Verify against the deployed URL, not localhost.** Submit one rating and confirm it
appears in the Supabase table editor. A misconfigured key fails at exactly this step
and nowhere earlier.

## Updating the corpus

The web app never edits clip data. To add or change clips:

```bash
cd "../Gradium test run"
uv run --env-file .env python run_batch.py     # synthesise + score
python export_site.py                          # publish to web/public/
```

Then redeploy. `export_site.py` writes `public/data/clips.json` and copies audio; both
are read straight from disk at request time.
