"use client";

import { useMemo, useState } from "react";
import type { Clip } from "@/lib/clips";
import { LANGUAGE_NAMES, verdictFor } from "@/lib/taxonomy";
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

const ALL = "__all__";

/** Word-level diff so a reader can see exactly where the transcript diverged. */
function diffWords(source: string, hypothesis: string) {
  const norm = (w: string) =>
    w.toLowerCase().replace(/[.,!?;:¿¡"“”'’()]/g, "");
  const src = source.split(/\s+/).filter(Boolean);
  const hyp = hypothesis.split(/\s+/).filter(Boolean);

  // Standard LCS table; the corpus lines are short enough that this is free.
  const n = src.length;
  const m = hyp.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        norm(src[i]) === norm(hyp[j])
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const srcMarks: boolean[] = new Array(n).fill(false);
  const hypMarks: boolean[] = new Array(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(src[i]) === norm(hyp[j])) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      srcMarks[i] = true;
      i++;
    } else {
      hypMarks[j] = true;
      j++;
    }
  }
  while (i < n) srcMarks[i++] = true;
  while (j < m) hypMarks[j++] = true;

  return { src, hyp, srcMarks, hypMarks };
}

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
  const [onlyMismatched, setOnlyMismatched] = useState(false);

  const langs = useMemo(
    () => [...new Set(clips.map((c) => c.lang))].sort(),
    [clips],
  );

  const filtered = useMemo(
    () =>
      clips.filter(
        (c) =>
          (lang === ALL || c.lang === lang) &&
          (!onlyMismatched || c.metrics.int.wer_pct > 0),
      ),
    [clips, lang, onlyMismatched],
  );

  return (
    <div className="space-y-6">
      {/* --- Filters --- */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setLang(ALL)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm transition-colors",
            lang === ALL ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
          )}
        >
          All languages
        </button>
        {langs.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              lang === l ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {LANGUAGE_NAMES[l] ?? l}
          </button>
        ))}

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
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
        Showing {filtered.length} of {clips.length} clips. Highlighted words mark where the
        transcript diverged from the source: amber for words the recogniser missed, red for
        words it added. A divergence is not automatically a synthesis defect, since the
        recogniser makes its own mistakes.
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
                    <span className="ml-auto flex items-center gap-3 font-mono text-xs text-muted-foreground">
                      <span>{c.audio_s.toFixed(1)}s</span>
                      <span
                        className={cn(
                          verdictFor("wer_pct", c.metrics.int.wer_pct) === "fail" &&
                            "text-red-600 dark:text-red-400",
                        )}
                      >
                        WER {c.metrics.int.wer_pct}%
                      </span>
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

                  {clean ? (
                    <p className="text-xs text-muted-foreground">
                      Transcript matches the source exactly.
                    </p>
                  ) : (
                    <p className="font-mono text-xs text-muted-foreground">
                      {c.metrics.int.sub} sub · {c.metrics.int.ins} ins · {c.metrics.int.del} del
                      · CER {c.metrics.int.cer_pct}%
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
