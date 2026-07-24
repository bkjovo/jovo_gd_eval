/**
 * The defect taxonomy shared by the harness and the site.
 *
 * Every subjective checkbox a rater can tick is declared here alongside the
 * objective metric that is supposed to detect the same thing. That pairing is the
 * whole methodology: it turns "sounds robotic" into "UTMOS + F0 semitone std".
 *
 * Where `metricKeys` is empty the dimension is one humans can hear and the
 * automated stack cannot see. Those are deliberate, not omissions.
 *
 * Note that `group` and `dimension` are different axes and are allowed to disagree.
 * `group` is how a reviewer thinks about a defect while listening; `dimension` is
 * which measurement family the defect belongs to. Pronunciation failure is grouped
 * under naturalness for reviewers but measured as intelligibility.
 */

export type Dimension = "intelligibility" | "performance" | "expressiveness" | "naturalness";

export const DIMENSIONS: Record<
  Dimension,
  { code: string; label: string; blurb: string }
> = {
  intelligibility: {
    code: "D-INT",
    label: "Intelligibility",
    blurb:
      "Did it say the right words? WER and CER from an ASR round-trip against the source, plus the word-level flags and adjudication from review.",
  },
  performance: {
    code: "D-PERF",
    label: "Performance",
    blurb: "Time-to-first-audio and real-time factor.",
  },
  expressiveness: {
    code: "D-EXP",
    label: "Expressiveness",
    blurb:
      "Did it vary the way a person would? Pitch range, pauses and pace, with reviewer calls on tone and stress.",
  },
  naturalness: {
    code: "D-NAT",
    label: "Naturalness",
    blurb:
      "Did it sound like a real, native human? Predicted MOS, the human 100%-human judgement, and accent.",
  },
};

/** How defects are grouped in the review UI. */
export type TagGroup =
  | "robustness"
  | "naturalness"
  | "expressiveness"
  | "technical"
  | "general";

export type DefectTag = {
  id: string;
  label: string;
  group: TagGroup;
  dimension: Dimension | null;
  /** Objective metrics that should fire on the same defect. Empty = known blind spot. */
  metricKeys: string[];
  /** Shown in the methodology table. */
  note: string;
  /**
   * Documented in the methodology, but NOT offered as a chip in the review UI because
   * a dedicated probe now collects it with better resolution. Collecting the same
   * signal twice would split it across two fields and double-count the clips where a
   * reviewer ticked both.
   */
  probeOnly?: boolean;
};

export const DEFECT_TAGS: DefectTag[] = [
  {
    id: "hallucination",
    label: "Hallucination",
    group: "robustness",
    dimension: "intelligibility",
    metricKeys: ["int.ins"],
    note: "Model said something that is not in the source text. Surfaces as ASR insertions.",
  },
  {
    id: "number_grouping",
    label: "Number grouping",
    group: "robustness",
    dimension: "intelligibility",
    metricKeys: ["int.sub"],
    note: "Digits read in the wrong grouping (\"fifteen\" vs \"one five\"). A substitution on numeric tokens.",
  },
  {
    id: "truncation",
    label: "Cut off / truncated",
    group: "robustness",
    dimension: "intelligibility",
    metricKeys: ["int.trailing_del", "int.dur_expected_ratio"],
    note: "Audio ends before the text does. Trailing deletions plus a short duration-vs-expected ratio.",
  },
  {
    id: "pronunciation",
    label: "Pronunciation failure",
    group: "naturalness",
    dimension: "intelligibility",
    metricKeys: ["int.sub", "int.cer_pct"],
    note: "Word said wrong. Surfaces as an ASR substitution or elevated character error rate.",
  },
  {
    id: "accent",
    label: "Accent",
    group: "naturalness",
    dimension: "naturalness",
    metricKeys: [],
    probeOnly: true,
    note: "BLIND SPOT. No reference-free metric in the stack scores accent appropriateness, and it is only partly covered by review. A reviewer can flag an individual code-switched word as carrying the wrong accent; whether the voice as a whole sounds native for its market is not collected, because a per-clip question answered identically fifty times produces agreement rather than information.",
  },
  {
    id: "robotic",
    label: "Robotic tone",
    group: "naturalness",
    dimension: "naturalness",
    metricKeys: ["nat.utmos", "nat.f0_semitone_std"],
    note: "Flat, synthetic delivery. Low pitch variance is the objective correlate of monotone.",
  },
  {
    id: "unnatural",
    label: "Feels unnatural",
    group: "naturalness",
    dimension: "naturalness",
    metricKeys: ["nat.utmos"],
    note: "General naturalness. UTMOS is trained to predict exactly this judgement.",
  },
  {
    id: "pauses",
    label: "Pauses",
    group: "expressiveness",
    dimension: "naturalness",
    metricKeys: ["nat.n_pauses", "nat.speaking_rate_wps"],
    note: "Breaks in the wrong place, or absent where expected. Pause count and speaking rate.",
  },
  {
    id: "inflection",
    label: "Inflection",
    group: "expressiveness",
    dimension: "naturalness",
    metricKeys: ["nat.f0_semitone_std"],
    note: "Wrong intonation contour: statements rising, questions falling. Partially captured by F0 variance.",
  },
  {
    id: "audio_quality",
    label: "Audio quality",
    group: "technical",
    dimension: "performance",
    metricKeys: ["aud.dnsmos_ovrl", "aud.snr_db_est", "aud.clipping_pct"],
    note: "Artifacts, noise, distortion. DNSMOS P.835 plus signal-level checks.",
  },
  {
    id: "other",
    label: "Other",
    group: "general",
    dimension: null,
    metricKeys: [],
    note: "Free-text escape hatch. Reviewed manually; the source of new taxonomy rows.",
  },
];

export const TAGS_BY_ID: Record<string, DefectTag> = Object.fromEntries(
  DEFECT_TAGS.map((t) => [t.id, t]),
);

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
};

/**
 * Pass / investigate / action-required cut-offs. The Performance page's verdict dots
 * and derived findings compare measured values against these.
 */
export const THRESHOLDS = {
  wer_pct: { warn: 5, fail: 10, higherIsWorse: true },
  cer_pct: { warn: 3, fail: 8, higherIsWorse: true },
  utmos: { warn: 3.8, fail: 3.5, higherIsWorse: false },
  dnsmos_ovrl: { warn: 3.2, fail: 3.0, higherIsWorse: false },
  clipping_pct: { warn: 0.1, fail: 1.0, higherIsWorse: true },
  snr_db_est: { warn: 50, fail: 40, higherIsWorse: false },
  // Applied to p90, not the median: a tail that misses the budget is what a
  // caller actually notices.
  ttfa_p90_ms: { warn: 300, fail: 500, higherIsWorse: true },
  rtf_p50: { warn: 0.7, fail: 1.0, higherIsWorse: true },
} as const;

export type ThresholdKey = keyof typeof THRESHOLDS;

export type Verdict = "pass" | "warn" | "fail";

export function verdictFor(key: ThresholdKey, value: number | null): Verdict {
  if (value === null || Number.isNaN(value)) return "pass";
  const t = THRESHOLDS[key];
  if (t.higherIsWorse) {
    if (value >= t.fail) return "fail";
    if (value >= t.warn) return "warn";
  } else {
    if (value <= t.fail) return "fail";
    if (value <= t.warn) return "warn";
  }
  return "pass";
}

/** Mean human score below which a clip counts as rejected in per-clip aggregates. */
export const HUMAN_REJECT_BELOW = 3.0;

