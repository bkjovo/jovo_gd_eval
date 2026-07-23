"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type Example = {
  id: string;
  lang: string;
  stress: string;
  text: string;
  hypothesis: string;
  audioUrl: string;
};

export type UseCase = {
  id: string;
  label: string;
  tag: string;
  blurb: string;
  accent: AccentKey;
  objective: { wer: string; ttfa: number; f0: string; utmos: string };
  raterStats: { value: string; label: string }[];
  examples: Example[];
};

export type MarketingData = {
  common: {
    languages: string[];
    voiceCount: number;
    clipCount: number;
  };
  useCases: UseCase[];
};

type AccentKey = "emerald" | "sky" | "violet" | "amber";

const ACCENT: Record<
  AccentKey,
  { text: string; soft: string; border: string; active: string; grad: string; dot: string }
> = {
  emerald: {
    text: "text-emerald-600 dark:text-emerald-400",
    soft: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    active: "bg-emerald-600 text-white border-emerald-600",
    grad: "from-emerald-500/15 to-transparent",
    dot: "bg-emerald-500",
  },
  sky: {
    text: "text-sky-600 dark:text-sky-400",
    soft: "bg-sky-500/10",
    border: "border-sky-500/30",
    active: "bg-sky-600 text-white border-sky-600",
    grad: "from-sky-500/15 to-transparent",
    dot: "bg-sky-500",
  },
  violet: {
    text: "text-violet-600 dark:text-violet-400",
    soft: "bg-violet-500/10",
    border: "border-violet-500/30",
    active: "bg-violet-600 text-white border-violet-600",
    grad: "from-violet-500/15 to-transparent",
    dot: "bg-violet-500",
  },
  amber: {
    text: "text-amber-600 dark:text-amber-400",
    soft: "bg-amber-500/10",
    border: "border-amber-500/30",
    active: "bg-amber-600 text-white border-amber-600",
    grad: "from-amber-500/15 to-transparent",
    dot: "bg-amber-500",
  },
};

const LANG_NAME: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
};

function Stat({
  value,
  unit,
  label,
  accent,
}: {
  value: string;
  unit?: string;
  label: string;
  accent: (typeof ACCENT)[AccentKey];
}) {
  return (
    <div className={cn("rounded-xl border p-4", accent.border, accent.soft)}>
      <div className="flex items-baseline gap-1">
        <span className={cn("text-3xl font-semibold tracking-tight tabular-nums", accent.text)}>
          {value}
        </span>
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function GtmMarketing({ data }: { data: MarketingData }) {
  const [active, setActive] = useState(data.useCases[0].id);
  const uc = data.useCases.find((u) => u.id === active) ?? data.useCases[0];
  const a = ACCENT[uc.accent];

  return (
    <div className="space-y-12">
      {/* --- Hero / common --- */}
      <section className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Gradium Text-to-Speech
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Voice your product can ship.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Natural, low-latency speech that gets the hard parts right, the account codes,
            dosages, and proper nouns that break other models, across every language your
            customers speak.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-gradient-to-br from-muted/60 to-transparent p-5">
            <div className="text-3xl font-semibold tracking-tight">
              {data.common.languages.length}
            </div>
            <div className="mt-1 text-sm font-medium">Languages</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {data.common.languages.map((l) => LANG_NAME[l] ?? l).join(", ")}
            </div>
          </div>
          <div className="rounded-xl border bg-gradient-to-br from-muted/60 to-transparent p-5">
            <div className="text-3xl font-semibold tracking-tight">1 credit</div>
            <div className="mt-1 text-sm font-medium">per character</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              ~45,000 characters is about an hour of audio.
            </div>
          </div>
          <div className="rounded-xl border bg-gradient-to-br from-muted/60 to-transparent p-5">
            <div className="text-3xl font-semibold tracking-tight">$3.80</div>
            <div className="mt-1 text-sm font-medium">per 100k credits, at scale</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Roughly $1.70 an hour of audio. Free tier to start.
            </div>
          </div>
        </div>
      </section>

      {/* --- Use-case selector --- */}
      <section className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {data.useCases.map((u) => {
            const on = u.id === active;
            const ua = ACCENT[u.accent];
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setActive(u.id)}
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-medium transition-colors sm:px-5 sm:py-2.5 sm:text-base",
                  on ? ua.active : "hover:bg-muted",
                )}
              >
                {u.label}
              </button>
            );
          })}
        </div>

        {/* --- Selected use case --- */}
        <div
          className={cn(
            "space-y-8 rounded-2xl border bg-gradient-to-br p-6 sm:p-8",
            a.border,
            a.grad,
          )}
        >
          <div className="space-y-2">
            <div className={cn("inline-flex items-center gap-2 text-sm font-medium", a.text)}>
              <span className={cn("size-2 rounded-full", a.dot)} />
              {uc.tag}
            </div>
            <p className="max-w-2xl text-lg leading-relaxed text-foreground sm:text-xl">
              {uc.blurb}
            </p>
          </div>

          {/* objective stats */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Measured on this vertical
            </h2>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat value={uc.objective.wer} unit="%" label="Word error rate" accent={a} />
              <Stat value={String(uc.objective.ttfa)} unit="ms" label="Time to first audio (p90)" accent={a} />
              <Stat value={uc.objective.f0} unit="st" label="Pitch variation" accent={a} />
              <Stat value={uc.objective.utmos} unit="/ 5" label="Predicted naturalness" accent={a} />
            </div>
          </div>

          {/* rater stats */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              What expert reviewers found
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {uc.raterStats.map((s) => (
                <div
                  key={s.label}
                  className={cn("flex items-baseline gap-3 rounded-xl border bg-background/60 p-4")}
                >
                  <span className={cn("text-2xl font-semibold tabular-nums", a.text)}>
                    {s.value}
                  </span>
                  <span className="text-sm leading-snug text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* examples */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Hard cases, reviewed clean
            </h2>
            <div className="space-y-3">
              {uc.examples.map((ex) => (
                <div key={ex.id} className="rounded-xl border bg-background/60 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-medium",
                        a.soft,
                        a.text,
                      )}
                    >
                      {ex.stress.replace(/_/g, " ")}
                    </span>
                    <span className="text-muted-foreground">{LANG_NAME[ex.lang] ?? ex.lang}</span>
                  </div>
                  <p className="text-sm font-medium leading-relaxed">{ex.text}</p>
                  <audio src={ex.audioUrl} controls preload="none" className="mt-3 w-full" />
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="uppercase tracking-wide">Transcribed back as:</span>{" "}
                    {ex.hypothesis}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
