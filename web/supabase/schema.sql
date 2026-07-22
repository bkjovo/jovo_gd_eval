-- Soundcheck rating store schema.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent.
--
-- Access model: the Next.js API route talks to PostgREST with the SERVICE ROLE key,
-- server-side only. RLS is enabled with no policies, so the anon key can read and
-- write nothing at all, while the service role bypasses RLS and keeps working. If the
-- anon key ever leaks, the table is still closed.

create extension if not exists pgcrypto;

create table if not exists public.ratings (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- Anonymous, client-generated, stored in localStorage. Groups one sitting.
  session_id  text        not null check (length(session_id) between 1 and 64),
  clip_id     text        not null check (length(clip_id) between 1 and 64),

  -- 1 to 5, deliberately the same scale as UTMOS/DNSMOS so the two are comparable
  -- without a mapping step. This is the only scalar reviewers give; the blind-spot
  -- rule treats a mean below 3.0 as human rejection.
  overall     smallint    not null check (overall between 1 and 5),

  -- Defect taxonomy ids. Intentionally NOT constrained to an enum here: taxonomy.ts
  -- is the single source of truth and the API filters unknown ids before insert.
  -- Duplicating the list in SQL would mean two places to edit per new defect type.
  defect_tags text[]      not null default '{}',

  -- Free text, only populated when the "other" tag is selected.
  other_text  text        check (other_text is null or length(other_text) <= 500),

  -- Answers to the targeted probes, as {probe_id: option_value}. These capture the
  -- things no reference-free metric can see: HOW a code/acronym/ALL-CAPS word was
  -- vocalized (every reading transcribes back identically, so WER is blind), and
  -- whether the accent is right (nothing in the stack scores it at all).
  -- Stored as jsonb rather than columns because the probe set is driven by each
  -- clip's stress_category and will grow as the corpus does.
  probes      jsonb       not null default '{}'::jsonb,

  -- Quality-control signals. Lets low-effort submissions be filtered after the fact,
  -- and replay count is itself evidence of a confusing clip.
  listened_ms integer     not null default 0 check (listened_ms >= 0),
  replays     smallint    not null default 0 check (replays >= 0),

  -- One rating per clip per session. Absorbs double-submits and network retries, and
  -- stops a single sitting inflating a clip's sample size. The API upserts against
  -- this constraint, so a genuine re-review overwrites rather than erroring.
  -- Note: a determined actor can clear localStorage for a fresh session_id. This is a
  -- data-hygiene guard, not access control.
  constraint ratings_session_clip_unique unique (session_id, clip_id)
);

-- Aggregation is per-clip; the listing endpoint orders by recency.
create index if not exists ratings_clip_id_idx    on public.ratings (clip_id);
create index if not exists ratings_created_at_idx on public.ratings (created_at desc);

alter table public.ratings enable row level security;

-- Deliberately no policies. See the access model note above.
-- To confirm the table is closed to the anon key:
--   select * from pg_policies where tablename = 'ratings';   -- expect zero rows
