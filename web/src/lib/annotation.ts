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
  { id: "number", label: "Number or date" },
  { id: "currency", label: "Currency / money" },
  { id: "code", label: "Code mispronounced" },
  { id: "proper_noun", label: "Mispronounced name or place" },
  { id: "homograph", label: "Homograph (read vs read)" },
  // Accent at the WORD level: a French word inside an English sentence, "lag" inside
  // German. Distinct from the clip-level ACCENT_OPTIONS question, which asks whether
  // the voice as a whole sounds native. This one is a specific, checkable claim about
  // one word; that one is a general impression.
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

/**
 * Only asked when the reviewer says it did not sound fully human.
 *
 * Two levels. The top level is what a listener notices ("the timing is off"); the
 * second says which way, which is what a fix needs. Both levels are multi-select and
 * both are stored flat in delivery_problems, so a row reads
 * ["spacing", "choppy", "speed", "too_fast"].
 *
 * Several ids are carried over from the previous flat list (robotic, odd_pauses,
 * running_together, too_fast, too_slow, voice_drift) so the answers already collected
 * still resolve to a label instead of rendering as raw ids.
 */
export const DELIVERY_PROBLEMS: {
  id: string;
  label: string;
  kinds: { id: string; label: string }[];
}[] = [
  {
    id: "stress",
    label: "Stress / emphasis",
    kinds: [
      { id: "robotic", label: "The voice sounds robotic, there's not enough variation" },
      { id: "missed_stress", label: "The voice missed opportunities to stress words" },
      { id: "wrong_stress", label: "Emphasized the wrong word" },
    ],
  },
  {
    id: "spacing",
    label: "Spacing",
    kinds: [
      { id: "odd_pauses", label: "Too much pausing" },
      { id: "choppy", label: "Choppy delivery: feels mechanical" },
      {
        id: "running_together",
        label: "Words running together: not enough space between words",
      },
    ],
  },
  {
    id: "speed",
    label: "Speed",
    kinds: [
      { id: "too_fast", label: "Too fast" },
      { id: "too_slow", label: "Too slow" },
    ],
  },
  { id: "voice_drift", label: "The voice drifting", kinds: [] },
];

/** Flattened, for label lookup and validation across both levels. */
export const DELIVERY_ALL: { id: string; label: string }[] = DELIVERY_PROBLEMS.flatMap((d) => [
  { id: d.id, label: d.label },
  ...d.kinds,
]);

/**
 * Clip-level accent. Reinstated after being removed: the earlier objection was that a
 * reviewer answers it the same way every clip, which is still a risk, so it is read as
 * a share across many clips rather than as a per-clip verdict. Nothing in the automated
 * stack scores accent at all, which is why it is worth collecting even noisily.
 */
export const ACCENT_OPTIONS: { id: string; label: string }[] = [
  { id: "native", label: "Sounds native" },
  { id: "slight", label: "Slightly off, but fine" },
  { id: "wrong_region", label: "Wrong region for the language" },
  { id: "non_native", label: "Sounds non-native" },
  { id: "unsure", label: "Couldn't tell" },
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
  /**
   * "Did this sound 100% human?" This is the real answer to the naturalness question.
   * The `overall` column is a 1-5 smallint with a NOT NULL check constraint, so it
   * cannot hold a boolean; it carries a shim value instead. See submitAll in rater.tsx.
   */
  sounded_human?: boolean | null;
  tone?: string | null;
  delivery_problems?: string[];
  accent?: string | null;
  /** {source_word_index: adjudication_id} */
  adjudication?: Record<string, string>;
};

export const TONE_IDS = new Set(TONES.map((t) => t.id));
export const DELIVERY_IDS = new Set(DELIVERY_ALL.map((d) => d.id));
export const ACCENT_IDS = new Set(ACCENT_OPTIONS.map((a) => a.id));
export const WORD_ISSUE_IDS = new Set(WORD_ISSUES.map((w) => w.id));
