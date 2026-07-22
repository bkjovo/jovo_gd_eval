import "server-only";
import { HUMAN_REJECT_BELOW } from "./taxonomy";

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
  /** Targeted probe answers, {probe_id: option_value}. Covers what metrics cannot see. */
  probes?: Record<string, string>;
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
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ratings?on_conflict=session_id,clip_id`,
    {
      method: "POST",
      headers: {
        ...headers(),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rating),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Supabase upsert failed (${res.status}): ${await res.text()}`);
  }
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
  /** {probe_id: {option_value: count}} — the blind-spot answers, aggregated. */
  probe_counts: Record<string, Record<string, number>>;
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
      probe_counts: {},
    });
    a.n += 1;
    a.mean_overall += r.overall;
    a.reject_rate += r.overall < HUMAN_REJECT_BELOW ? 1 : 0;
    for (const t of r.defect_tags ?? []) {
      a.tag_counts[t] = (a.tag_counts[t] ?? 0) + 1;
    }
    for (const [probe, answer] of Object.entries(r.probes ?? {})) {
      (a.probe_counts[probe] ??= {})[answer] = (a.probe_counts[probe]?.[answer] ?? 0) + 1;
    }
  }
  for (const a of Object.values(out)) {
    a.mean_overall = a.n ? a.mean_overall / a.n : NaN;
    a.reject_rate = a.n ? a.reject_rate / a.n : NaN;
  }
  return out;
}
