"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { verdictFor } from "@/lib/taxonomy";
import { ACCENT_OPTIONS, PRONUNCIATION_KINDS, type WordFlag } from "@/lib/annotation";
import { cn } from "@/lib/utils";

export type RevealMetrics = {
  wer_pct: number;
  cer_pct: number;
  truncated: boolean;
  hypothesis: string;
  utmos: number;
  f0_semitone_std: number;
  dnsmos_ovrl: number;
  ttfa_p50_ms: number | null;
};

/**
 * Shown only after the rating is submitted. This is the point of the whole exercise:
 * the reviewer commits blind, then sees what the automated stack said about the same
 * clip. Where the two disagree is the finding.
 */
export function RatingReveal({
  sourceText,
  overall,
  metrics,
  wordFlags,
  accent,
  stressCategory,
}: {
  sourceText: string;
  overall: number;
  metrics: RevealMetrics;
  wordFlags: WordFlag[];
  accent: string | null;
  stressCategory: string;
}) {
  // UTMOS is a 1-5 predicted MOS, the same scale the reviewer just used, so it is the
  // one metric directly comparable to their score.
  const delta = overall - metrics.utmos;
  const agrees = Math.abs(delta) < 0.75;

  const metricsClean =
    verdictFor("wer_pct", metrics.wer_pct) === "pass" &&
    verdictFor("utmos", metrics.utmos) === "pass" &&
    verdictFor("dnsmos_ovrl", metrics.dnsmos_ovrl) === "pass";

  // Things the reviewer caught that no reference-free metric produces: a specific word
  // localised as mispronounced, or an accent judgement. WER cannot point at a word, and
  // nothing in the stack scores accent at all.
  const caught: { label: string; why: string }[] = wordFlags
    .filter((f) => f.issue === "pronunciation")
    .map((f) => ({
      label: `“${f.word}” — ${
        PRONUNCIATION_KINDS.find((k) => k.id === f.kind)?.label ?? "pronunciation"
      }`,
      why: "word error rate cannot localise which word broke, only that something did.",
    }));

  const accentOpt = ACCENT_OPTIONS.find((a) => a.id === accent);
  if (accentOpt && !accentOpt.expected && accent !== "unsure") {
    caught.push({
      label: accentOpt.label,
      why: "nothing in the automated stack scores accent.",
    });
  }

  const transcriptDiffers =
    metrics.hypothesis.trim().toLowerCase().replace(/[.,!?¿¡]/g, "") !==
    sourceText.trim().toLowerCase().replace(/[.,!?¿¡]/g, "");

  return (
    <div className="space-y-4">
      {/* --- headline: you vs the machine --- */}
      <Card
        className={cn(
          "border-2",
          agrees ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5",
        )}
      >
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-around gap-6 text-center">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">You</div>
              <div className="mt-1 text-4xl font-bold tabular-nums">{overall}</div>
              <div className="text-xs text-muted-foreground">out of 5</div>
            </div>
            <div className="text-sm text-muted-foreground">vs</div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                UTMOS predicted
              </div>
              <div className="mt-1 text-4xl font-bold tabular-nums">
                {metrics.utmos.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">out of 5</div>
            </div>
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {agrees ? (
              <>You and the naturalness model broadly agree on this clip.</>
            ) : delta < 0 ? (
              <>
                <span className="font-medium text-foreground">You rated it lower</span> than the
                model predicted. Disagreements in this direction are the ones worth reading.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">You rated it higher</span> than the
                model predicted, which usually means the metric is being harsh.
              </>
            )}
          </p>
        </CardContent>
      </Card>

      {/* --- the blind-spot catch: the reason this tool exists --- */}
      {caught.length > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium">
              You caught {caught.length === 1 ? "something" : "things"} no metric can measure
            </h3>
            <ul className="mt-2 space-y-1.5">
              {caught.map((c, i) => (
                <li key={i} className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{c.label}</span>
                  {": "}
                  {c.why}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* --- what the machine measured --- */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Word errors", value: `${metrics.wer_pct.toFixed(1)}%`, key: "wer_pct" as const, v: metrics.wer_pct },
              { label: "Naturalness", value: metrics.utmos.toFixed(2), key: "utmos" as const, v: metrics.utmos },
              { label: "Audio quality", value: metrics.dnsmos_ovrl.toFixed(2), key: "dnsmos_ovrl" as const, v: metrics.dnsmos_ovrl },
              { label: "Pitch range", value: `${metrics.f0_semitone_std.toFixed(1)} st`, key: null, v: null },
            ].map((m) => {
              const verdict = m.key ? verdictFor(m.key, m.v) : "pass";
              return (
                <div key={m.label} className="rounded-md border p-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{m.label}</span>
                    {m.key ? (
                      <span
                        className={cn(
                          "ml-auto h-1.5 w-1.5 rounded-full",
                          verdict === "fail"
                            ? "bg-red-500"
                            : verdict === "warn"
                              ? "bg-amber-500"
                              : "bg-emerald-500",
                        )}
                      />
                    ) : null}
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{m.value}</div>
                </div>
              );
            })}
          </div>

          {/* The ASR round trip, which is where WER actually comes from. */}
          <div>
            <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              What the speech recogniser heard
            </div>
            <p className="rounded-md border bg-muted/30 p-3 text-sm">
              {metrics.hypothesis || <span className="text-muted-foreground">nothing</span>}
            </p>
            {transcriptDiffers ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                This differs from the source text. A difference here is not automatically a
                model defect: the recogniser makes its own mistakes, which is exactly why
                your judgement is being collected.
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Character-identical to the source text.
              </p>
            )}
          </div>

          {metricsClean && overall <= 2 ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm">
              <span className="font-medium">Every automated check passed this clip</span>, and
              you scored it {overall}/5. That gap is the single most useful thing this tool
              produces, and it goes straight to the research dashboard.
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className="text-[10px]">
              {stressCategory.replace(/_/g, " ")}
            </Badge>
            {metrics.truncated ? (
              <Badge variant="outline" className="border-red-500/40 text-[10px] text-red-600">
                truncated
              </Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
