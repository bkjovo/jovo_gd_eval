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

export type Dimension = "int" | "nat" | "aud" | "lat";

export const DIMENSIONS: Record<
  Dimension,
  { code: string; label: string; blurb: string }
> = {
  int: {
    code: "D-INT",
    label: "Intelligibility",
    blurb: "Did it say the right words? ASR round-trip against the source text.",
  },
  nat: {
    code: "D-NAT",
    label: "Naturalness",
    blurb: "Does it sound like a person? Predicted MOS plus prosody statistics.",
  },
  aud: {
    code: "D-AUD",
    label: "Audio quality",
    blurb: "Signal-level artifacts, level, and noise, independent of the words.",
  },
  lat: {
    code: "D-LAT",
    label: "Latency",
    blurb: "Client-side time-to-first-audio and real-time factor.",
  },
};

/** How defects are grouped in the review UI. */
export type TagGroup =
  | "robustness"
  | "naturalness"
  | "expressiveness"
  | "technical"
  | "general";

export const TAG_GROUPS: Record<TagGroup, { label: string; blurb: string }> = {
  robustness: {
    label: "Robustness",
    blurb: "Did it render the text faithfully?",
  },
  naturalness: {
    label: "Naturalness",
    blurb: "Does it sound like a person speaking?",
  },
  expressiveness: {
    label: "Expressiveness",
    blurb: "Is the delivery shaped the right way?",
  },
  technical: {
    label: "Technical",
    blurb: "Is the audio itself clean?",
  },
  general: {
    label: "Something else",
    blurb: "",
  },
};

export const TAG_GROUP_ORDER: TagGroup[] = [
  "robustness",
  "naturalness",
  "expressiveness",
  "technical",
  "general",
];

export type DefectTag = {
  id: string;
  label: string;
  group: TagGroup;
  dimension: Dimension | null;
  /** Objective metrics that should fire on the same defect. Empty = known blind spot. */
  metricKeys: string[];
  /** Shown in the methodology table. */
  note: string;
};

export const DEFECT_TAGS: DefectTag[] = [
  {
    id: "hallucination",
    label: "Hallucination",
    group: "robustness",
    dimension: "int",
    metricKeys: ["int.ins"],
    note: "Model said something that is not in the source text. Surfaces as ASR insertions.",
  },
  {
    id: "number_grouping",
    label: "Number grouping",
    group: "robustness",
    dimension: "int",
    metricKeys: ["int.sub"],
    note: "Digits read in the wrong grouping (\"fifteen\" vs \"one five\"). A substitution on numeric tokens.",
  },
  {
    id: "truncation",
    label: "Cut off / truncated",
    group: "robustness",
    dimension: "int",
    metricKeys: ["int.trailing_del", "int.dur_expected_ratio"],
    note: "Audio ends before the text does. Trailing deletions plus a short duration-vs-expected ratio.",
  },
  {
    id: "pronunciation",
    label: "Pronunciation failure",
    group: "naturalness",
    dimension: "int",
    metricKeys: ["int.sub", "int.cer_pct"],
    note: "Word said wrong. Surfaces as an ASR substitution or elevated character error rate.",
  },
  {
    id: "accent",
    label: "Accent",
    group: "naturalness",
    dimension: "nat",
    metricKeys: [],
    note: "BLIND SPOT. No reference-free metric in the stack scores accent appropriateness. Human-only signal.",
  },
  {
    id: "robotic",
    label: "Robotic tone",
    group: "naturalness",
    dimension: "nat",
    metricKeys: ["nat.utmos", "nat.f0_semitone_std"],
    note: "Flat, synthetic delivery. Low pitch variance is the objective correlate of monotone.",
  },
  {
    id: "unnatural",
    label: "Feels unnatural",
    group: "naturalness",
    dimension: "nat",
    metricKeys: ["nat.utmos"],
    note: "General naturalness. UTMOS is trained to predict exactly this judgement.",
  },
  {
    id: "pauses",
    label: "Pauses",
    group: "expressiveness",
    dimension: "nat",
    metricKeys: ["nat.n_pauses", "nat.speaking_rate_wps"],
    note: "Breaks in the wrong place, or absent where expected. Pause count and speaking rate.",
  },
  {
    id: "inflection",
    label: "Inflection",
    group: "expressiveness",
    dimension: "nat",
    metricKeys: ["nat.f0_semitone_std"],
    note: "Wrong intonation contour: statements rising, questions falling. Partially captured by F0 variance.",
  },
  {
    id: "audio_quality",
    label: "Audio quality",
    group: "technical",
    dimension: "aud",
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

export function tagsInGroup(group: TagGroup): DefectTag[] {
  return DEFECT_TAGS.filter((t) => t.group === group);
}

/** Tags with no objective counterpart, quoted directly in the methodology. */
export const BLIND_SPOT_TAGS = DEFECT_TAGS.filter(
  (t) => t.id !== "other" && t.metricKeys.length === 0,
);

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
};

/**
 * Thresholds for derived action items. Nothing on the exec summary is hand-written;
 * every callout is produced by comparing measured values against these.
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

/**
 * Mean human score below which a clip counts as rejected by reviewers. Used by the
 * blind-spot rule now that reviewers no longer make an explicit ship call.
 */
export const HUMAN_REJECT_BELOW = 3.0;

/** Loudness consistency target. Spread across a corpus matters more than absolute level. */
export const LUFS_SPREAD_WARN_LU = 3.0;
