import { cn } from "@/lib/utils";

/**
 * Topline verdict. Resolves to Yes only when nothing below is marked action-required,
 * so it can never be more optimistic than the findings that produced it.
 *
 * Driven entirely by objective thresholds. Human review can add an action-required
 * finding (a metric blind spot), which flips this to No without any measured score
 * being altered.
 */
export function ReadyToShip({
  ready,
  blockerCount,
  clipCount,
}: {
  ready: boolean;
  blockerCount: number;
  clipCount: number;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border-2 p-5",
        ready
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-red-500/50 bg-red-500/10",
      )}
    >
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Ready to ship
        </div>
        <div
          className={cn(
            "mt-0.5 text-4xl font-bold tracking-tight",
            ready
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-red-700 dark:text-red-400",
          )}
        >
          {ready ? "Yes" : "No"}
        </div>
      </div>

      <p className="max-w-xl flex-1 text-sm text-muted-foreground">
        {ready ? (
          <>
            No action-required findings across {clipCount} clips. Every measured value sits
            inside its declared threshold. Items marked{" "}
            <span className="font-medium text-foreground">Investigate</span> below are worth
            reading, but none of them block a release.
          </>
        ) : (
          <>
            {blockerCount} action-required finding{blockerCount === 1 ? "" : "s"} across{" "}
            {clipCount} clips. This resolves to Yes only once every one of them is cleared;
            see the list below.
          </>
        )}
      </p>
    </div>
  );
}
