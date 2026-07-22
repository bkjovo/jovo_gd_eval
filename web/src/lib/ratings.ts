import "server-only";
import { HUMAN_REJECT_BELOW } from "./taxonomy";
import type { Annotation } from "./annotation";

/**
 * Rating store.
 *
 * Talks to Supabase over its REST API when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * are present, and falls back to an in-process array otherwise so the site is fully
 * functional locally with no backing service.
 *
 * The service-role key is read server-side only and never reaches the browser.
 * That is why writes go through /api/ratings rather than a browser Supabase client.
 *
 * NOTE: the in-memory fallback does not survive a serverless cold start. Any
 * deployment meant to collect real rater input must have the env vars set; the UI
 * surfaces `persisted: false` so this can never be silently wrong.
 */

export type Rating = {
  id?: string;
  created_at?: string;
  session_id: string;
  clip_id: string;
  /** 1–5 overall quality. Same scale as UTMOS/DNSMOS so the two are comparable. */
  overall: number;
  defect_tags: string[];
  other_text?: string | null;
  /**
   * The structured annotation payload: word-level flags, cut-off, audio issues, tone,
   * delivery problems, and ASR adjudication. Stored in one jsonb
   * column so the review flow can evolve without a migration per question.
   */
  probes?: Annotation;
  listened_ms: number;
  replays: number;
};

/**
 * Route handlers and server components are bundled separately, so a plain
 * module-level array gives each its own copy and ratings written through the API
 * never appear on the pages. Hanging it off globalThis shares one array per process.
 */
const globalForRatings = globalThis as unknown as { __soundcheckRatings?: Rating[] };
const memoryStore: Rating[] = (globalForRatings.__soundcheckRatings ??= []);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isPersisted(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Set when a write had to drop probe answers because the database predates the
 * `probes` column. Surfaced in the UI so missing blind-spot data is never silent.
 * Clears itself as soon as a write succeeds with probes intact.
 */
let probesColumnMissing = false;

export function probesDropped(): boolean {
  return probesColumnMissing;
}

/**
 * Ask the database directly whether the `probes` column exists.
 *
 * The flag above only knows about writes this particular process handled, which on
 * serverless means a page render usually cannot see it. This asks once per process and
 * caches, so the banner is trustworthy no matter which instance renders the page.
 * Returns true when unknown, so a transient network failure never produces a false alarm.
 */
let probesColumnKnown: boolean | null = null;

export async function probesColumnAvailable(): Promise<boolean> {
  if (!isPersisted()) return true;
  if (probesColumnKnown !== null) return probesColumnKnown;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ratings?select=probes&limit=1`, {
      headers: headers(),
      cache: "no-store",
    });
    probesColumnKnown = res.ok;
  } catch {
    probesColumnKnown = true; // unknown: do not cry wolf
  }
  return probesColumnKnown;
}

function headers() {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_KEY as string,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

export async function insertRating(rating: Rating): Promise<void> {
  if (!isPersisted()) {
    // Mirror the DB's one-row-per-(session, clip) rule so local behaviour matches prod.
    const existing = memoryStore.findIndex(
      (r) => r.session_id === rating.session_id && r.clip_id === rating.clip_id,
    );
    const row = { ...rating, created_at: new Date().toISOString() };
    if (existing >= 0) memoryStore[existing] = row;
    else memoryStore.push(row);
    return;
  }

  // Upsert against ratings_session_clip_unique: a retried submit is absorbed, and a
  // genuine re-review replaces the earlier row instead of erroring.
  const send = (body: Rating | Omit<Rating, "probes">) =>
    fetch(`${SUPABASE_URL}/rest/v1/ratings?on_conflict=session_id,clip_id`, {
      method: "POST",
      headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

  const res = await send(rating);
  if (res.ok) {
    probesColumnMissing = false;
    return;
  }

  // The `probes` column was added after the table shipped. If a deployment points at a
  // database that predates it, the rating itself is still worth keeping: drop the probe
  // answers and save the rest rather than losing the whole submission. The gap is
  // recorded and surfaced in the UI so it is never silently wrong, and the moment the
  // column is added the next write succeeds on the first attempt with no redeploy.
  // Two different errors mean the same thing here, so both are matched: a SELECT
  // surfaces Postgres's own 42703 ("column ... does not exist"), while an INSERT is
  // rejected earlier by PostgREST's schema cache as PGRST204 ("could not find the
  // 'probes' column ... in the schema cache").
  const detail = await res.text();
  if (
    res.status === 400 &&
    /probes/.test(detail) &&
    /does not exist|42703|PGRST204|schema cache/i.test(detail)
  ) {
    probesColumnMissing = true;
    const { probes: _dropped, ...withoutProbes } = rating;
    const retry = await send(withoutProbes);
    if (retry.ok) return;
    throw new Error(`Supabase upsert failed (${retry.status}): ${await retry.text()}`);
  }
  throw new Error(`Supabase upsert failed (${res.status}): ${detail}`);
}

export async function listRatings(): Promise<Rating[]> {
  if (!isPersisted()) return [...memoryStore];
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ratings?select=*&order=created_at.desc&limit=5000`,
    { headers: headers(), cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as Rating[];
}

/** Aggregate shape consumed by the deep-dive and exec summary. */
export type ClipAggregate = {
  clip_id: string;
  n: number;
  mean_overall: number;
  /** Share of reviewers scoring the clip below HUMAN_REJECT_BELOW. */
  reject_rate: number;
  tag_counts: Record<string, number>;
  /** Word-level pronunciation kinds flagged, e.g. {homograph: 3, code: 1}. */
  word_kind_counts: Record<string, number>;
  /** Bare word issues, {dropped, wrong_word, pronunciation}. */
  word_issue_counts: Record<string, number>;
  tone_counts: Record<string, number>;
  delivery_counts: Record<string, number>;
  cut_off_yes: number;
  audio_issue_yes: number;
  /** ASR adjudication tallies: was the audio wrong, or the transcript? */
  adjudication_counts: Record<string, number>;
};

export function aggregateByClip(ratings: Rating[]): Record<string, ClipAggregate> {
  const out: Record<string, ClipAggregate> = {};
  for (const r of ratings) {
    const a = (out[r.clip_id] ??= {
      clip_id: r.clip_id,
      n: 0,
      mean_overall: 0,
      reject_rate: 0,
      tag_counts: {},
      word_kind_counts: {},
      word_issue_counts: {},
      tone_counts: {},
      delivery_counts: {},
      cut_off_yes: 0,
      audio_issue_yes: 0,
      adjudication_counts: {},
    });
    a.n += 1;
    a.mean_overall += r.overall;
    a.reject_rate += r.overall < HUMAN_REJECT_BELOW ? 1 : 0;
    for (const t of r.defect_tags ?? []) {
      a.tag_counts[t] = (a.tag_counts[t] ?? 0) + 1;
    }
    const ann = r.probes ?? {};
    for (const f of ann.word_flags ?? []) {
      a.word_issue_counts[f.issue] = (a.word_issue_counts[f.issue] ?? 0) + 1;
      if (f.kind) a.word_kind_counts[f.kind] = (a.word_kind_counts[f.kind] ?? 0) + 1;
    }
    if (ann.tone) a.tone_counts[ann.tone] = (a.tone_counts[ann.tone] ?? 0) + 1;
    for (const d of ann.delivery_problems ?? []) {
      a.delivery_counts[d] = (a.delivery_counts[d] ?? 0) + 1;
    }
    if (ann.cut_off) a.cut_off_yes += 1;
    if (ann.audio_issue) a.audio_issue_yes += 1;
    for (const v of Object.values(ann.adjudication ?? {})) {
      a.adjudication_counts[v] = (a.adjudication_counts[v] ?? 0) + 1;
    }
  }
  for (const a of Object.values(out)) {
    a.mean_overall = a.n ? a.mean_overall / a.n : NaN;
    a.reject_rate = a.n ? a.reject_rate / a.n : NaN;
  }
  return out;
}
