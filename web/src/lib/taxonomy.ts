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

/** Chips offered to a reviewer. Excludes tags a dedicated probe already covers. */
export function tagsInGroup(group: TagGroup): DefectTag[] {
  return DEFECT_TAGS.filter((t) => t.group === group && !t.probeOnly);
}

/** Tags with no objective counterpart, quoted directly in the methodology. */
export const BLIND_SPOT_TAGS = DEFECT_TAGS.filter(
  (t) => t.id !== "other" && t.metricKeys.length === 0,
);

/**
 * Targeted probes: the questions no reference-free metric can answer.
 *
 * WER is computed through an ASR round-trip, so it is blind to HOW something was
 * vocalized: "A739K2" read character-by-character and read in chunks both transcribe
 * back to the same string. Same for whether an acronym was spelled or said as a word,
 * or whether an ALL-CAPS word was emphasized or spelled out letter by letter.
 *
 * Each clip already declares a `stress_category`, so the reviewer can be asked the
 * one question that matters for that clip instead of a generic checklist. This is the
 * human layer covering a declared blind spot, rather than duplicating what the
 * automated stack already measures.
 *
 * `expected` marks the reading a production system would want; it is NOT shown to the
 * reviewer (that would lead the answer) and is only used when summarising results.
 */
export type Probe = {
  id: string;
  question: string;
  hint?: string;
  options: { value: string; label: string; expected?: boolean }[];
};

export const PROBES: Record<string, Probe> = {
  code_reading: {
    id: "code_reading",
    question: "How did it read the code?",
    hint: "Word error rate cannot tell these apart; every reading transcribes the same.",
    options: [
      { value: "char_by_char", label: "Character by character", expected: true },
      { value: "chunked", label: "Grouped into chunks (“seventy-three”)" },
      { value: "as_word", label: "Ran it together as a word" },
      { value: "wrong", label: "Got a character wrong" },
      { value: "unsure", label: "Couldn’t tell" },
    ],
  },
  number_reading: {
    id: "number_reading",
    question: "How did it read the number?",
    options: [
      { value: "natural", label: "Naturally, the way a person would", expected: true },
      { value: "digits", label: "Digit by digit" },
      { value: "wrong_value", label: "Said the wrong value" },
      { value: "wrong_unit", label: "Fumbled the unit or currency" },
      { value: "unsure", label: "Couldn’t tell" },
    ],
  },
  acronym_reading: {
    id: "acronym_reading",
    question: "How did it read the acronym?",
    options: [
      { value: "letters", label: "Letter by letter", expected: true },
      { value: "as_word", label: "As a word" },
      { value: "expanded", label: "Expanded it into full words" },
      { value: "wrong", label: "Got it wrong" },
      { value: "unsure", label: "Couldn’t tell" },
    ],
  },
  url_reading: {
    id: "url_reading",
    question: "How did it read the web address?",
    options: [
      { value: "natural", label: "Clearly, dots and slashes spoken", expected: true },
      { value: "ran_together", label: "Ran it together, hard to follow" },
      { value: "skipped", label: "Skipped or garbled part of it" },
      { value: "unsure", label: "Couldn’t tell" },
    ],
  },
  caps_reading: {
    id: "caps_reading",
    question: "The text had a word in CAPITALS. What did it do?",
    hint: "Capitals are a common way to mark emphasis in product copy.",
    options: [
      { value: "emphasis", label: "Said it with emphasis", expected: true },
      { value: "normal", label: "Read it normally, no emphasis" },
      { value: "spelled", label: "Spelled it out letter by letter" },
      { value: "unsure", label: "Couldn’t tell" },
    ],
  },
  name_reading: {
    id: "name_reading",
    question: "How did it handle the names?",
    options: [
      { value: "confident", label: "Pronounced them confidently and consistently", expected: true },
      { value: "inconsistent", label: "Pronounced the same name differently each time" },
      { value: "mangled", label: "Clearly mangled them" },
      { value: "unsure", label: "Couldn’t tell" },
    ],
  },
  homograph_reading: {
    id: "homograph_reading",
    question: "One word here can be pronounced two ways. Did it pick the right one?",
    hint: "This is the single hardest thing for a text-to-speech model to get right.",
    options: [
      { value: "correct", label: "Yes, correct for the context", expected: true },
      { value: "wrong", label: "No, it used the other pronunciation" },
      { value: "unsure", label: "Couldn’t tell" },
    ],
  },
  loanword_reading: {
    id: "loanword_reading",
    question: "How did it pronounce the English words?",
    options: [
      { value: "native_en", label: "Like an English speaker would", expected: true },
      { value: "localised", label: "Adapted to this language’s sounds" },
      { value: "mangled", label: "Mangled them" },
      { value: "unsure", label: "Couldn’t tell" },
    ],
  },
};

/**
 * Which probe (if any) a clip's stress category earns. Categories not listed here get
 * no targeted probe: the generic score and defect tags already cover them.
 */
export const PROBE_BY_STRESS: Record<string, string> = {
  alphanumeric_code: "code_reading",
  url_code: "code_reading",
  digit_string: "code_reading",
  phone_number: "code_reading",
  currency_decimal: "number_reading",
  numbers_units: "number_reading",
  decimal_units: "number_reading",
  percentage: "number_reading",
  time_days: "number_reading",
  acronym: "acronym_reading",
  acronym_percentage: "acronym_reading",
  url: "url_reading",
  caps_emphasis: "caps_reading",
  proper_noun: "name_reading",
  date_time_proper_noun: "name_reading",
  long_prosody_proper_noun: "name_reading",
  homograph: "homograph_reading",
  loanword_codeswitch: "loanword_reading",
};

export function probeFor(stressCategory: string): Probe | null {
  const id = PROBE_BY_STRESS[stressCategory];
  return id ? PROBES[id] ?? null : null;
}

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
