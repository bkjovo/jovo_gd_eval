/**
 * The annotation vocabulary for the review flow.
 *
 * Structured as three passes, because they are three different judgements and mixing
 * them biases all of them:
 *
 *   1. ACCURACY  — source text on screen, click the words that went wrong. Runs on
 *      EVERY clip, including the 64% that score 0% WER. That coverage matters: 100%
 *      of code and acronym clips and 80% of homographs score clean, because those
 *      defects are invisible to an ASR round-trip by construction. Gating this pass
 *      on WER > 0 would skip precisely the clips the corpus exists to test.
 *   2. IMPRESSION — how it sounds, judged holistically and blind.
 *   3. ADJUDICATION — only when WER > 0, and only on the disputed words: was the
 *      audio actually wrong, or did the recogniser mishear? Runs LAST so the metric's
 *      verdict cannot anchor the score given in pass 2.
 *
 * Everything is stored in one jsonb column so the flow can evolve without a migration
 * per question.
 */

export type WordIssue = "dropped" | "wrong_word" | "pronunciation";

export const WORD_ISSUES: { id: WordIssue; label: string }[] = [
  { id: "dropped", label: "Didn’t exist in the audio" },
  { id: "wrong_word", label: "Was the wrong word" },
  { id: "pronunciation", label: "Pronunciation" },
];

/** Shown only after the reviewer picks "Pronunciation" on a word. */
export const PRONUNCIATION_KINDS: { id: string; label: string }[] = [
  { id: "acronym", label: "Acronym problem" },
  { id: "number", label: "Number, date, currency problem" },
  { id: "code", label: "Code mispronounced" },
  { id: "proper_noun", label: "Mispronounced name or place" },
  { id: "homograph", label: "Homograph (read vs read)" },
  // Accent at the WORD level only: a French word inside an English sentence, "lag"
  // inside German. A clip-level "does the whole voice sound native" question existed
  // briefly and was removed, because asking it on every clip returns the same answer
  // fifty times, which is agreement rather than information. A single code-switched
  // word is a specific, checkable claim.
  { id: "accent", label: "Wrong accent for this word" },
  { id: "other", label: "Something else" },
];

export const PRONUNCIATION_KIND_IDS = new Set(PRONUNCIATION_KINDS.map((k) => k.id));

/** One flagged word from pass 1. Index is into the whitespace-split source text. */
export type WordFlag = {
  index: number;
  word: string;
  issue: WordIssue;
  /** Only set when issue === "pronunciation". */
  kind?: string;
};

export const TONES: { id: string; label: string }[] = [
  { id: "warm_friendly", label: "Warm & friendly" },
  { id: "serious", label: "Serious" },
  { id: "urgent", label: "Urgent" },
  { id: "excited", label: "Excited & energetic" },
  { id: "flat_neutral", label: "Flat / neutral" },
  { id: "other", label: "Something else" },
];

/**
 * Tone that a use case would plausibly want. Not shown to the reviewer, and not a
 * pass/fail: it turns a subjective read into a derived finding, e.g. "this healthcare
 * clip was heard as excited & energetic". No metric in the stack captures register.
 */
export const TONE_FIT: Record<string, string[]> = {
  healthcare: ["warm_friendly", "serious", "flat_neutral"],
  banking: ["serious", "flat_neutral", "warm_friendly"],
  customer_service: ["warm_friendly", "serious", "flat_neutral"],
  gaming_npc: ["excited", "urgent", "serious", "warm_friendly"],
};

/** Only asked when the human score is below 5. */
export const DELIVERY_PROBLEMS: { id: string; label: string }[] = [
  { id: "robotic", label: "Robotic / monotone" },
  { id: "odd_pauses", label: "Odd pauses or choppy delivery" },
  { id: "running_together", label: "Words running together" },
  { id: "too_fast", label: "Too fast" },
  { id: "too_slow", label: "Too slow" },
  { id: "voice_drift", label: "Voice drifted" },
];

/**
 * Pass 3. The disputed word is one the recogniser transcribed differently from the
 * source; the reviewer decides which side was actually wrong. This is what turns a
 * raw WER into a corrected one, and it is the only way to measure our own instrument.
 */
export const ADJUDICATION: { id: string; label: string }[] = [
  { id: "audio_wrong", label: "The audio really was wrong" },
  { id: "asr_wrong", label: "The audio was fine, the transcript is wrong" },
  { id: "unsure", label: "Couldn’t tell" },
];

export const ADJUDICATION_IDS = new Set(ADJUDICATION.map((a) => a.id));

/** The full payload stored in the `probes` jsonb column. */
export type Annotation = {
  word_flags?: WordFlag[];
  cut_off?: boolean | null;
  audio_issue?: boolean | null;
  tone?: string | null;
  delivery_problems?: string[];
  /** {source_word_index: adjudication_id} */
  adjudication?: Record<string, string>;
};

export const TONE_IDS = new Set(TONES.map((t) => t.id));
export const DELIVERY_IDS = new Set(DELIVERY_PROBLEMS.map((d) => d.id));
export const WORD_ISSUE_IDS = new Set(WORD_ISSUES.map((w) => w.id));
