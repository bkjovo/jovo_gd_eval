# Web app

Next.js site. Reads `public/data/clips.json` (written by the harness) and nothing
else; human annotations are stored in Supabase.

## Pages

| Route | Contents |
|---|---|
| `/` | Welcome: decisions, limitations, observations |
| `/rate` | Blind annotation flow — word-level errors, impression, ASR adjudication |
| `/metrics` | Performance: objective metrics, top issues, human findings, per-clip detail |
| `/samples` | Every clip with its audio and ASR transcript diff |
| `/method` | Methodology: pipeline, taxonomy, rating flow, WER approach, limitations |
| `/gtm` | Customer-facing marketing page, per use case |

Raters never see a machine score: metrics are stripped from the payload the
review page receives (`src/app/rate/page.tsx`), and the transcript endpoint
returns no quality fields.

## Development

```bash
npm install
npm run dev
```

Runs without any backing service — ratings fall back to an in-process store. For
persistent ratings, copy `.env.example` to `.env.local` and set:

- `SUPABASE_URL` — Supabase → Project Settings → Data API
- `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API Keys (server-side only)

Table schema: [`supabase/schema.sql`](supabase/schema.sql).

Note: this is Next.js 16, which has breaking changes from 15. Its docs ship in
`node_modules/next/dist/docs/`.
