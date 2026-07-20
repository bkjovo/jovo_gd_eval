import { loadClips } from "@/lib/load-clips";
import { aggregateByClip, listRatings, type Rating } from "@/lib/ratings";
import { MetricsExplorer } from "@/components/metrics-explorer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Metrics Deep Dive · Soundcheck",
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
          Metrics Deep Dive
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every objective measurement, cut by language, difficulty, and use case,
          alongside what human reviewers flagged on the same clips.
        </p>
      </div>

      <MetricsExplorer
        clips={clips}
        aggregates={aggregates}
        totalRatings={ratings.length}
      />
    </div>
  );
}
