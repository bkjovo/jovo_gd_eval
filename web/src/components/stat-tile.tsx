import { cn } from "@/lib/utils";
import type { Verdict } from "@/lib/taxonomy";

const VERDICT_DOT: Record<Verdict, string> = {
  pass: "bg-emerald-500",
  warn: "bg-amber-500",
  fail: "bg-red-500",
};

export function StatTile({
  dimension,
  label,
  value,
  unit,
  verdict,
  caption,
}: {
  dimension?: string;
  label: string;
  value: string;
  unit?: string;
  verdict?: Verdict;
  caption?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        {dimension ? (
          <span className="text-xs font-semibold tracking-tight">{dimension}</span>
        ) : null}
        {verdict ? (
          <span
            className={cn("ml-auto h-1.5 w-1.5 rounded-full", VERDICT_DOT[verdict])}
            aria-label={verdict}
          />
        ) : null}
      </div>
      <div className="mt-1.5 text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      {caption ? (
        <div className="mt-1.5 text-xs text-muted-foreground">{caption}</div>
      ) : null}
    </div>
  );
}
