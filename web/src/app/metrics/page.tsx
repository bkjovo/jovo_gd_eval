import { loadClips } from "@/lib/load-clips";
import { aggregateByClip, listRatings, type Rating } from "@/lib/ratings";
import { MetricsExplorer } from "@/components/metrics-explorer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Performance",
};

export default async function MetricsPage() {
  const { clips } = loadClips();

  let ratings: Rating[] = [];
  try {
    ratings = await listRatings();
  } catch {
    ratings = [];
  }
  const aggregates = aggregateByClip(ratings);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Performance
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every objective measurement, cut by language, stress case, and use case,
          alongside what human reviewers flagged on the same clips.
        </p>
      </div>

      <MetricsExplorer
        clips={clips}
        aggregates={aggregates}
        totalRatings={ratings.length}
        coverage={{
          ratings: ratings.length,
          clipsRated: Object.keys(aggregates).length,
          sessions: new Set(ratings.map((r) => r.session_id)).size,
        }}
      />
    </div>
  );
}
