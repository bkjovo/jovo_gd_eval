/**
 * The corpus has 22 stress categories, which is too many for a filter dropdown. These
 * seven buckets group them for the cut controls on the Performance and Samples pages.
 *
 * Only the DROPDOWN is bucketed. Findings (the worst-stress-case panel, the per-clip
 * table, the GTM figures) still read the granular stress_category, because "proper noun
 * is the worst" is actionable and "names, dates & times is the worst" is not.
 */
export const STRESS_BUCKETS: { id: string; label: string; categories: string[] }[] = [
  {
    id: "acronyms_codes",
    label: "Acronyms & codes",
    categories: ["acronym", "acronym_percentage", "alphanumeric_code", "url_code"],
  },
  {
    id: "numbers_currency",
    label: "Numbers & currency",
    categories: ["currency_decimal", "decimal_units", "digit_string", "numbers_units", "percentage"],
  },
  {
    id: "phone_web",
    label: "Phone & web",
    categories: ["phone_number", "url"],
  },
  {
    id: "names_dates",
    label: "Names, dates & times",
    categories: ["proper_noun", "date_time_proper_noun", "time_days", "long_prosody_proper_noun"],
  },
  {
    id: "emphasis_homograph",
    label: "Emphasis & homographs",
    categories: ["caps_emphasis", "homograph"],
  },
  {
    id: "loanwords",
    label: "Loanwords & code-switching",
    categories: ["loanword_codeswitch"],
  },
  {
    id: "longform_conversational",
    label: "Long-form & conversational",
    categories: ["long_prosody", "long_prosody_instructions", "long_prosody_terms", "very_short_question"],
  },
];

const CAT_TO_BUCKET = new Map<string, string>();
for (const b of STRESS_BUCKETS) for (const c of b.categories) CAT_TO_BUCKET.set(c, b.id);

const BUCKET_LABEL = new Map(STRESS_BUCKETS.map((b) => [b.id, b.label]));

/** Bucket id for a raw stress category, or the category itself if unmapped (so a new
 * category is never silently dropped from a filtered view). */
export function stressBucketOf(category: string): string {
  return CAT_TO_BUCKET.get(category) ?? category;
}

export function stressBucketLabel(id: string): string {
  return BUCKET_LABEL.get(id) ?? id.replace(/_/g, " ");
}

/** Bucket ids that actually have a clip in the given set, in canonical order. */
export function stressBucketOptions(categories: string[]): string[] {
  const present = new Set(categories.map(stressBucketOf));
  const ordered = STRESS_BUCKETS.filter((b) => present.has(b.id)).map((b) => b.id);
  // Any unmapped category surfaces as its own option rather than disappearing.
  const extras = [...present].filter((id) => !BUCKET_LABEL.has(id)).sort();
  return [...ordered, ...extras];
}
