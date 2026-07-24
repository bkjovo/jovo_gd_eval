"use client";

import { useMemo, useState } from "react";
import { byCorpusOrder, type Clip } from "@/lib/clips";
import { diffWords } from "@/lib/word-diff";
import { LANGUAGE_NAMES, verdictFor } from "@/lib/taxonomy";
import { ALL, FilterSelect } from "@/components/filter-select";
import { stressBucketLabel, stressBucketOf, stressBucketOptions } from "@/lib/stress-buckets";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Browse surface: every clip with its audio and the ASR transcript side by side.
 *
 * The point is to make the intelligibility metric auditable. WER is computed from this
 * transcript, so seeing the two texts together is the only way to tell a synthesis
 * error from a recogniser error. Unlike the review flow, metrics are shown here
 * deliberately; this page is for inspection, not for collecting blind judgements.
 */

function DiffText({
  words,
  marks,
  tone,
}: {
  words: string[];
  marks: boolean[];
  tone: "source" | "hypothesis";
}) {
  return (
    <p className="text-sm leading-relaxed">
      {words.map((w, i) => (
        <span
          key={i}
          className={cn(
            marks[i] &&
              (tone === "source"
                ? "rounded bg-amber-500/20 px-0.5 font-medium"
                : "rounded bg-red-500/15 px-0.5 font-medium"),
          )}
        >
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}

export function SampleBrowser({ clips }: { clips: Clip[] }) {
  const [lang, setLang] = useState(ALL);
  const [stress, setStress] = useState(ALL);
  const [useCase, setUseCase] = useState(ALL);
  const [onlyMismatched, setOnlyMismatched] = useState(false);

  const options = useMemo(
    () => ({
      langs: [...new Set(clips.map((c) => c.lang))].sort(),
      stress: stressBucketOptions(clips.map((c) => c.stress_category)),
      useCases: [...new Set(clips.map((c) => c.use_case))].sort(),
    }),
    [clips],
  );

  const filtered = useMemo(
    () =>
      clips
        .filter(
          (c) =>
            (lang === ALL || c.lang === lang) &&
            (stress === ALL || stressBucketOf(c.stress_category) === stress) &&
            (useCase === ALL || c.use_case === useCase) &&
            (!onlyMismatched || c.metrics.int.wer_pct > 0),
        )
        .sort(byCorpusOrder),
    [clips, lang, stress, useCase, onlyMismatched],
  );

  return (
    <div className="space-y-6">
      {/* --- Cuts --- */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
        <FilterSelect
          label="Language"
          value={lang}
          options={options.langs}
          onChange={setLang}
          format={(l) => LANGUAGE_NAMES[l] ?? l}
        />
        <FilterSelect
          label="Stress case"
          value={stress}
          options={options.stress}
          onChange={setStress}
          format={stressBucketLabel}
        />
        <FilterSelect
          label="Use case"
          value={useCase}
          options={options.useCases}
          onChange={setUseCase}
          format={(u) => u.replace(/_/g, " ")}
        />
        <label className="ml-auto flex cursor-pointer items-center gap-2 pb-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyMismatched}
            onChange={(e) => setOnlyMismatched(e.target.checked)}
            className="h-4 w-4 rounded border"
          />
          Only clips where the transcript differs
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {clips.length} clips. Amber marks words the recogniser
        missed, red marks words it added. A divergence is not necessarily a synthesis
        defect: the recogniser makes its own errors.
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No clips match this filter.
        </p>
      ) : (
        <div className="space-y-4">
          {filtered.map((c) => {
            const { src, hyp, srcMarks, hypMarks } = diffWords(
              c.text,
              c.metrics.int.hypothesis || "",
            );
            const clean = c.metrics.int.wer_pct === 0 && c.metrics.int.cer_pct === 0;
            return (
              <Card key={c.id} id={c.id} className="scroll-mt-20">
                <CardContent className="space-y-4 pt-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{c.id}</span>
                    <Badge variant="secondary">{LANGUAGE_NAMES[c.lang] ?? c.lang}</Badge>
                    <Badge variant="outline">{c.voice_name}</Badge>
                    <Badge variant="outline">{c.difficulty}</Badge>
                    <Badge variant="outline">
                      {c.stress_category.replace(/_/g, " ")}
                    </Badge>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      latency: {c.metrics.lat.ttfa_p50_ms.toFixed(0)} ms
                    </span>
                  </div>

                  <audio src={c.audio_url} controls preload="none" className="w-full" />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border bg-muted/30 p-3">
                      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Source text
                      </div>
                      <DiffText words={src} marks={srcMarks} tone="source" />
                    </div>
                    <div className="rounded-md border bg-muted/30 p-3">
                      <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span>ASR transcript</span>
                        <span className="font-mono normal-case">
                          detected {c.metrics.int.detected_lang}
                        </span>
                      </div>
                      {hyp.length ? (
                        <DiffText words={hyp} marks={hypMarks} tone="hypothesis" />
                      ) : (
                        <p className="text-sm text-muted-foreground">No transcript.</p>
                      )}
                    </div>
                  </div>

                  <p className="flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "font-medium",
                        verdictFor("wer_pct", c.metrics.int.wer_pct) === "fail"
                          ? "text-red-600 dark:text-red-400"
                          : "text-foreground",
                      )}
                    >
                      WER {c.metrics.int.wer_pct}%
                    </span>
                    <span>{c.metrics.int.sub} sub</span>
                    <span>{c.metrics.int.ins} ins</span>
                    <span>{c.metrics.int.del} del</span>
                    <span>CER {c.metrics.int.cer_pct}%</span>
                    {clean ? <span>transcript matches source exactly</span> : null}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
