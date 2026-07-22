/**
 * Types mirror the payload written by `export_site.py`. The web app never edits
 * clip data by hand; regenerate the corpus and re-run the exporter instead.
 *
 * This module must stay free of Node built-ins: client components import the types
 * and helpers below, and a `node:fs` import here ends up in the browser bundle.
 * The filesystem loader lives in `load-clips.ts`.
 */

export type IntMetrics = {
  wer_pct: number;
  cer_pct: number;
  /** Reference word count, required to micro-average WER across clips. */
  ref_words: number;
  sub: number;
  ins: number;
  del: number;
  trailing_del: number;
  dur_expected_ratio: number;
  truncated: boolean;
  detected_lang: string;
  hypothesis: string;
};

export type NatMetrics = {
  utmos: number;
  f0_semitone_std: number;
  f0_mean_hz: number;
  n_pauses: number;
  speaking_rate_wps: number | null;
};

export type AudMetrics = {
  dnsmos_ovrl: number;
  dnsmos_sig: number;
  dnsmos_bak: number;
  lufs: number;
  peak_dbfs: number;
  clipping_pct: number;
  snr_db_est: number;
};

export type LatMetrics = {
  ttfa_p50_ms: number;
  ttfa_p90_ms: number;
  ttfa_iqr_ms: number;
  total_p50_ms: number;
  rtf_p50: number;
  n_trials: number;
  /** Raw per-trial measurements, pooled to compute a corpus-level percentile. */
  ttfa_trials_ms: number[];
};

export type Clip = {
  id: string;
  lang: string;
  text: string;
  voice_name: string;
  voice_id: string;
  difficulty: string;
  use_case: string;
  stress_category: string;
  audio_url: string;
  chars: number;
  audio_s: number;
  metrics: {
    int: IntMetrics;
    nat: NatMetrics;
    aud: AudMetrics;
    lat: LatMetrics;
  };
};

/**
 * What the blind review flow is allowed to receive. Metrics are structurally excluded
 * so a machine score cannot leak into the rating UI by accident.
 */
export type RaterClip = Omit<Clip, "metrics">;

export type ClipsPayload = {
  generated_at: string;
  n_clips: number;
  languages: string[];
  difficulties: string[];
  use_cases: string[];
  stress_categories: string[];
  unscored_manifest_ids: string[];
  clips: Clip[];
};

/**
 * Corpus display order: use case, then line number, then language.
 *
 * The JSON is in generation order, which appends the long_prosody lines at the end —
 * so health-07 landed after game-07 instead of after health-06. Ordering by the parts
 * of the id keeps every use case in one contiguous block.
 */
const LANG_ORDER = ["en", "es", "fr", "de", "pt"];

export function byCorpusOrder(a: Clip, b: Clip): number {
  const parse = (id: string) => {
    const m = /^([a-z]+)-(\d+)-([a-z]+)$/.exec(id);
    return m ? { group: m[1], n: Number(m[2]), lang: m[3] } : { group: id, n: 0, lang: "" };
  };
  const x = parse(a.id);
  const y = parse(b.id);
  return (
    x.group.localeCompare(y.group) ||
    x.n - y.n ||
    LANG_ORDER.indexOf(x.lang) - LANG_ORDER.indexOf(y.lang)
  );
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Corpus word error rate, micro-averaged: total errors over total reference words.
 *
 * NOT the mean of per-clip WERs. That macro-average weights every clip equally
 * regardless of length, so a two-word utterance counts as much as a twenty-word one
 * and the figure drifts with corpus composition rather than model quality. Micro is
 * the standard ASR convention and is what a research team expects to see.
 */
export function microWer(clips: Clip[]): { wer: number; errors: number; words: number } {
  let errors = 0;
  let words = 0;
  for (const c of clips) {
    errors += c.metrics.int.sub + c.metrics.int.ins + c.metrics.int.del;
    words += c.metrics.int.ref_words;
  }
  return { wer: words ? (errors / words) * 100 : NaN, errors, words };
}

/** Linear-interpolated percentile, the usual convention for latency reporting. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Corpus TTFA percentile over the pooled trials.
 *
 * Averaging per-clip p90s is not a percentile of anything: it is the mean of a set of
 * tail statistics, which understates the real tail and has no interpretation as an
 * SLO. Pooling every measurement and taking one percentile answers the question people
 * actually ask, "what does the slowest tenth of requests look like".
 *
 * Pooling is defensible for TTFA specifically because time-to-FIRST-audio is roughly
 * independent of text length. It would not be for total time or RTF, which scale with
 * the utterance and would mix populations.
 */
export function pooledTtfa(clips: Clip[], p = 90): { value: number; nTrials: number } {
  const all = clips.flatMap((c) => c.metrics.lat.ttfa_trials_ms ?? []);
  return { value: percentile(all, p), nTrials: all.length };
}

/** Pull a nested metric by "dimension.key" path, e.g. "int.wer_pct". */
export function metricValue(clip: Clip, key: string): number | null {
  const [dim, field] = key.split(".");
  const group = clip.metrics[dim as keyof Clip["metrics"]] as unknown as Record<
    string,
    unknown
  >;
  if (!group) return null;
  const v = group[field];
  return typeof v === "number" ? v : null;
}
