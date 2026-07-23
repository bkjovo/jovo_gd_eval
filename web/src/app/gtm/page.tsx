import { loadClips } from "@/lib/load-clips";
import { mean, microWer, pooledTtfa, type Clip } from "@/lib/clips";
import { GtmMarketing, type MarketingData, type UseCase } from "@/components/gtm-marketing";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Go-to-market",
};

/**
 * Customer-facing marketing page. Objective stats are computed from the same corpus
 * export that feeds the Performance tab, filtered per use case. Rater stats and example
 * clips are curated from the review data (favourable, verified against prod at build
 * time); example clips were all reviewed with no word-level errors flagged.
 */
type Curated = {
  id: string;
  label: string;
  tag: string;
  blurb: string;
  accent: UseCase["accent"];
  raterStats: { value: string; label: string }[];
  exampleIds: string[];
};

const CURATED: Curated[] = [
  {
    id: "healthcare",
    label: "Healthcare",
    tag: "Healthcare",
    blurb:
      "Precise with prescription names, dosages, and billing codes. It reads technical clinical speech the way a clinician would.",
    accent: "emerald",
    raterStats: [
      { value: "95%", label: "of reviewed clips had no word-level error flagged" },
      { value: "100%", label: "of disputed words traced to the transcriber, not the voice" },
    ],
    exampleIds: ["health-03-en", "health-07-en", "health-02-es"],
  },
  {
    id: "banking",
    label: "Banking",
    tag: "Banking",
    blurb:
      "At home with currencies, account codes, and complex transactions. The numbers come out right.",
    accent: "sky",
    raterStats: [
      { value: "92%", label: "of reviewers heard a native speaker" },
      { value: "100%", label: "of disputed words traced to the transcriber, not the voice" },
    ],
    exampleIds: ["bank-01-es", "bank-04-en", "bank-06-en"],
  },
  {
    id: "customer_service",
    label: "Customer service",
    tag: "Customer service",
    blurb:
      "Expressive and human, in near real-time. Customers get what they need without friction.",
    accent: "violet",
    raterStats: [
      { value: "85%", label: "of reviewed clips had no word-level error flagged" },
      { value: "87 ms", label: "time to first audio, p90" },
    ],
    exampleIds: ["cs-06-en", "cs-04-es", "cs-08-en"],
  },
  {
    id: "gaming_npc",
    label: "Gaming / NPC",
    tag: "Gaming & NPCs",
    blurb:
      "Natural, human voices that carry any emotion you need. Low latency makes personalized NPC interactions possible.",
    accent: "amber",
    raterStats: [
      { value: "95%", label: "of reviewed clips had no word-level error flagged" },
      { value: "9 in 10", label: "disputed words were the transcriber, not the voice" },
    ],
    exampleIds: ["game-07-en", "game-06-en", "game-05-es"],
  },
];

export default function GtmPage() {
  const { clips } = loadClips();
  const byId = new Map(clips.map((c) => [c.id, c]));

  const obj = (group: Clip[]) => ({
    wer: microWer(group).wer.toFixed(2),
    ttfa: Math.round(pooledTtfa(group, 90).value),
    f0: mean(group.map((c) => c.metrics.nat.f0_semitone_std)).toFixed(2),
    utmos: mean(group.map((c) => c.metrics.nat.utmos)).toFixed(2),
  });

  const useCases: UseCase[] = CURATED.map((cu) => {
    const group = clips.filter((c) => c.use_case === cu.id);
    return {
      id: cu.id,
      label: cu.label,
      tag: cu.tag,
      blurb: cu.blurb,
      accent: cu.accent,
      objective: obj(group),
      raterStats: cu.raterStats,
      examples: cu.exampleIds
        .map((id) => byId.get(id))
        .filter((c): c is Clip => Boolean(c))
        .map((c) => ({
          id: c.id,
          lang: c.lang,
          stress: c.stress_category,
          text: c.text,
          audioUrl: c.audio_url,
        })),
    };
  });

  const LANG_ORDER = ["en", "es", "fr", "de", "pt"];
  const data: MarketingData = {
    common: {
      languages: [...new Set(clips.map((c) => c.lang))].sort(
        (x, y) => LANG_ORDER.indexOf(x) - LANG_ORDER.indexOf(y),
      ),
      clipCount: clips.length,
    },
    useCases,
  };

  return (
    <div className="mx-auto max-w-4xl">
      <GtmMarketing data={data} />
    </div>
  );
}
