"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Clip } from "@/lib/clips";
import Link from "next/link";
import { mean, microWer, pooledTtfa } from "@/lib/clips";
import type { ClipAggregate } from "@/lib/ratings";
import {
  DIMENSIONS,
  LANGUAGE_NAMES,
  LUFS_SPREAD_WARN_LU,
  TAGS_BY_ID,
  THRESHOLDS,
  verdictFor,
} from "@/lib/taxonomy";
import {
  ACCENT_OPTIONS,
  DELIVERY_ALL,
  PRONUNCIATION_KINDS,
  TONES,
  TONE_FIT,
} from "@/lib/annotation";
import { ALL, FilterSelect } from "@/components/filter-select";
import { stressBucketLabel, stressBucketOf, stressBucketOptions } from "@/lib/stress-buckets";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Props = {
  clips: Clip[];
  aggregates: Record<string, ClipAggregate>;
  totalRatings: number;
  coverage: { ratings: number; clipsRated: number; sessions: number };
};

function byLanguage(clips: Clip[]) {
  const map = new Map<string, Clip[]>();
  for (const c of clips) map.set(c.lang, [...(map.get(c.lang) ?? []), c]);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function MetricsExplorer({ clips, aggregates, totalRatings, coverage }: Props) {
  const [lang, setLang] = useState(ALL);
  const [stress, setStress] = useState(ALL);
  const [useCase, setUseCase] = useState(ALL);
  const [selected, setSelected] = useState<string | null>(null);

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
      clips.filter(
        (c) =>
          (lang === ALL || c.lang === lang) &&
          (stress === ALL || stressBucketOf(c.stress_category) === stress) &&
          (useCase === ALL || c.use_case === useCase),
      ),
    [clips, lang, stress, useCase],
  );

  const crossLanguage = lang === ALL && options.langs.length > 1;

  return (
    <div className="space-y-8">
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
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {clips.length} clips
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No clips match this combination of cuts.
        </p>
      ) : (
        <>
          {/* --- Headline metrics for the cut --- */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Objective metrics</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                dimension={DIMENSIONS.intelligibility.label}
                label="Word error rate"
                value={microWer(filtered).wer.toFixed(2)}
                unit="%"
                verdict={verdictFor("wer_pct", microWer(filtered).wer)}
                caption={`${microWer(filtered).errors} errors / ${microWer(filtered).words} words`}
              />
              <StatTile
                dimension={DIMENSIONS.performance.label}
                label="Time-to-first-audio p90"
                value={pooledTtfa(filtered, 90).value.toFixed(0)}
                unit="ms"
                verdict={verdictFor("ttfa_p90_ms", pooledTtfa(filtered, 90).value)}
                caption={`DNSMOS ${mean(filtered.map((c) => c.metrics.aud.dnsmos_ovrl)).toFixed(2)} / 5 · ${mean(filtered.map((c) => c.metrics.aud.lufs)).toFixed(1)} LUFS`}
              />
              <StatTile
                dimension={DIMENSIONS.expressiveness.label}
                label="Pitch variation"
                value={mean(filtered.map((c) => c.metrics.nat.f0_semitone_std)).toFixed(2)}
                unit="st"
                caption={`${mean(filtered.map((c) => c.metrics.nat.n_pauses)).toFixed(1)} pauses avg · F0 semitone std`}
              />
              <StatTile
                dimension={DIMENSIONS.naturalness.label}
                label="UTMOS"
                value={mean(filtered.map((c) => c.metrics.nat.utmos)).toFixed(2)}
                unit="/ 5"
                verdict={verdictFor("utmos", mean(filtered.map((c) => c.metrics.nat.utmos)))}
                caption="Predicted MOS, English-trained"
              />
            </div>
            {crossLanguage ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Cross-language view.</span>{" "}
                UTMOS and DNSMOS are English-trained, so the naturalness and audio figures
                above are not comparable across languages. Word error rate is not either:
                it is measured through an ASR model whose own accuracy varies by language,
                so part of any gap is the recogniser rather than the voice. Filter to a
                single language before drawing conclusions. Latency is the one figure here
                that compares cleanly.
              </p>
            ) : null}
          </section>

          {/* --- Top issues: the headline numbers, read for meaning --- */}
          <TopIssues
            clips={filtered}
            aggregates={aggregates}
            showLanguage={crossLanguage}
            totalRatings={totalRatings}
          />

          {/* --- Blind-spot probe answers: the signal no metric produces --- */}
          <HumanFindings clips={filtered} aggregates={aggregates} />

          {/* --- Per-language objective breakdown, moved from the archived summary --- */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">By language (objective metrics only)</h2>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Language</TableHead>
                        <TableHead className="text-right">Clips</TableHead>
                        <TableHead className="text-right">WER %</TableHead>
                        <TableHead className="text-right">CER %</TableHead>
                        <TableHead className="text-right">UTMOS</TableHead>
                        <TableHead className="text-right">DNSMOS</TableHead>
                        <TableHead className="text-right">F0 std (st)</TableHead>
                        <TableHead className="text-right">TTFA p90</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byLanguage(filtered).map(([l, group]) => (
                        <TableRow key={l}>
                          <TableCell className="font-medium">
                            {LANGUAGE_NAMES[l] ?? l}
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {l}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{group.length}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {microWer(group).wer.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {mean(group.map((c) => c.metrics.int.cer_pct)).toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {mean(group.map((c) => c.metrics.nat.utmos)).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {mean(group.map((c) => c.metrics.aud.dnsmos_ovrl)).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {mean(group.map((c) => c.metrics.nat.f0_semitone_std)).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pooledTtfa(group, 90).value.toFixed(0)} ms
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* --- Review coverage, moved from the archived summary --- */}
          <section>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Review coverage</CardTitle>
                <CardDescription className="text-xs">
                  How much human signal backs the findings above.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">{coverage.ratings}</div>
                    <div className="text-xs text-muted-foreground">annotations collected</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">
                      {coverage.clipsRated}/{clips.length}
                    </div>
                    <div className="text-xs text-muted-foreground">clips with at least one</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">{coverage.sessions}</div>
                    <div className="text-xs text-muted-foreground">distinct rater sessions</div>
                  </div>
                </div>
                <Link
                  href="/rate"
                  className="inline-flex items-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
                >
                  Contribute a review
                </Link>
              </CardContent>
            </Card>
          </section>
          {/* --- Per-clip table. Rows expand in place: a detail panel rendered at the
               bottom of a 145-row table is off-screen from the row that opened it. --- */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Per-clip detail</h2>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Clip</TableHead>
                        <TableHead>Stress case</TableHead>
                        <TableHead className="text-right">WER %</TableHead>
                        <TableHead className="text-right">TTFA p90</TableHead>
                        <TableHead className="text-right"># annotations</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((c) => {
                        const agg = aggregates[c.id];
                        const isOpen = selected === c.id;
                        return (
                          <Fragment key={c.id}>
                            <TableRow
                              onClick={() => setSelected(isOpen ? null : c.id)}
                              className={cn("cursor-pointer", isOpen && "bg-muted/50")}
                            >
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  <ChevronRight
                                    className={cn(
                                      "size-3 shrink-0 text-muted-foreground transition-transform",
                                      isOpen && "rotate-90",
                                    )}
                                  />
                                  <div>
                                    <div className="font-mono text-xs">{c.id}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {LANGUAGE_NAMES[c.lang] ?? c.lang}
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {c.stress_category.replace(/_/g, " ")}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {c.metrics.int.wer_pct.toFixed(1)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {c.metrics.lat.ttfa_p90_ms.toFixed(0)} ms
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {agg?.n ?? 0}
                              </TableCell>
                            </TableRow>
                            {isOpen ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={5} className="bg-muted/30 p-4">
                                  <ClipDetail clip={c} agg={agg} />
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              Select a row to expand it. # annotations counts submitted reviews from the
              Annotate tab.
            </p>
          </section>

        </>
      )}
    </div>
  );
}

type Highlight = {
  id: string;
  /** Which evidence produced it. Labelled in the UI because the mix is the point. */
  kind: "measured" | "reviewers";
  value: string;
  unit?: string;
  title: string;
  detail: string;
  tone: "bad" | "warn";
};

/**
 * Top issues: the findings worth leading with for the current cut.
 *
 * Emitted in a fixed order of decision-relevance, taking the first five that clear
 * their threshold. Not sorted by a severity score: ranking a word error rate against a
 * loudness spread against a share of reviewers requires inventing an exchange rate
 * between unlike units, and the result would look objective without being it.
 *
 * Every grouped finding is guarded on two denominators, at least 25 words and more than
 * one clip. A stress category with nine words in the cut can hit 33% on a single
 * substitution, which is noise rather than a finding.
 */
function TopIssues({
  clips,
  aggregates,
  showLanguage,
  totalRatings,
}: {
  clips: Clip[];
  aggregates: Record<string, ClipAggregate>;
  showLanguage: boolean;
  totalRatings: number;
}) {
  const { highlights, reviewsInScope } = useMemo(() => {
    const out: Highlight[] = [];
    const overall = microWer(clips);

    /** Worst group by micro-averaged WER, or null when the cut cannot support one. */
    const worstBy = (key: (c: Clip) => string, minWords: number) => {
      const groups = new Map<string, Clip[]>();
      for (const c of clips) {
        const k = key(c);
        const list = groups.get(k);
        if (list) list.push(c);
        else groups.set(k, [c]);
      }
      if (groups.size < 2) return null;
      const rows = [...groups.entries()]
        .map(([k, cs]) => ({ k, count: cs.length, ...microWer(cs) }))
        // Two bars, both about not reporting noise as a finding: enough words that a
        // single substitution cannot swing the rate, and more than one clip, so the
        // claim is about a category rather than about one unlucky line.
        .filter((r) => r.words >= minWords && r.count >= 2)
        .sort((a, b) => b.wer - a.wer);
      return rows.length >= 2 ? rows[0] : null;
    };

    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

    const times = (v: number) =>
      overall.wer > 0.05
        ? `${(v / overall.wer).toFixed(1)}x the ${overall.wer.toFixed(1)}% average for this cut`
        : "cut average is effectively zero";

    // ---- reviewer-derived ----
    const reviewed = clips.filter((c) => (aggregates[c.id]?.n ?? 0) > 0);
    const reviewsInScope = reviewed.reduce((s, c) => s + (aggregates[c.id]?.n ?? 0), 0);
    const adj: Record<string, number> = {};
    for (const c of clips) {
      const a = aggregates[c.id];
      if (!a) continue;
      for (const [k, v] of Object.entries(a.adjudication_counts)) adj[k] = (adj[k] ?? 0) + v;
    }
    const adjAsr = adj.asr_wrong ?? 0;
    const adjAudio = adj.audio_wrong ?? 0;
    const adjTotal = adjAsr + adjAudio + (adj.unsure ?? 0);
    if (adjTotal >= 3) {
      out.push({
        id: "adjudication",
        kind: "reviewers",
        value: String(Math.round((adjAsr / adjTotal) * 100)),
        unit: "% of disputed words",
        title:
          "of ASR-identified WER errors (post-normalizations) were flagged by raters as non-issues",
        detail: `${adjTotal} disputed words adjudicated by ear. ${adjAudio} wrong in the audio, ${adjAsr} misheard by the recogniser. Raw WER counts both.`,
        tone: "warn",
      });
    }

    // ---- measured ----
    const byStress = worstBy((c) => c.stress_category, 25);
    if (byStress && byStress.wer >= THRESHOLDS.wer_pct.warn) {
      out.push({
        id: "stress",
        kind: "measured",
        value: byStress.wer.toFixed(1),
        unit: "% WER",
        title: `${byStress.k.replace(/_/g, " ")} is the worst stress case`,
        detail: `${plural(byStress.errors, "error")} across ${byStress.words} words in ${plural(byStress.count, "clip")}. ${times(byStress.wer)}.`,
        tone: verdictFor("wer_pct", byStress.wer) === "fail" ? "bad" : "warn",
      });
    }

    if (showLanguage) {
      const byLang = worstBy((c) => c.lang, 40);
      if (byLang && byLang.wer >= THRESHOLDS.wer_pct.warn) {
        out.push({
          id: "language",
          kind: "measured",
          value: byLang.wer.toFixed(1),
          unit: "% WER",
          title: `${LANGUAGE_NAMES[byLang.k] ?? byLang.k} has the highest word error rate`,
          detail: `${plural(byLang.errors, "error")} across ${byLang.words} words. Not comparable across languages: ASR accuracy itself varies by language.`,
          tone: "warn",
        });
      }
    }

    const byUse = worstBy((c) => c.use_case, 25);
    if (byUse && byUse.wer >= THRESHOLDS.wer_pct.warn) {
      out.push({
        id: "usecase",
        kind: "measured",
        value: byUse.wer.toFixed(1),
        unit: "% WER",
        title: `${byUse.k.replace(/_/g, " ")} is the worst use case`,
        detail: `${plural(byUse.errors, "error")} across ${byUse.words} words in ${plural(byUse.count, "clip")}. ${times(byUse.wer)}.`,
        tone: verdictFor("wer_pct", byUse.wer) === "fail" ? "bad" : "warn",
      });
    }

    // Register: no metric in the stack scores it, so reviewers are the only source.
    let toneMismatch = 0;
    let toneTotal = 0;
    for (const c of clips) {
      const a = aggregates[c.id];
      if (!a) continue;
      const fit = TONE_FIT[c.use_case];
      for (const [k, v] of Object.entries(a.tone_counts)) {
        toneTotal += v;
        if (fit && !fit.includes(k) && k !== "other") toneMismatch += v;
      }
    }
    if (toneTotal >= 5 && toneMismatch > 0) {
      out.push({
        id: "tone",
        kind: "reviewers",
        value: String(Math.round((toneMismatch / toneTotal) * 100)),
        unit: "% of tone judgements",
        title: "of clips were read in a tone that did not fit the use case",
        detail: `${toneMismatch} of ${toneTotal} tone judgements fell outside the register the use case calls for. No metric in the stack scores register.`,
        tone: "warn",
      });
    }

    const kinds: Record<string, number> = {};
    for (const c of clips) {
      const a = aggregates[c.id];
      if (!a) continue;
      for (const [k, v] of Object.entries(a.word_kind_counts)) kinds[k] = (kinds[k] ?? 0) + v;
    }
    const topKind = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0];
    if (topKind && topKind[1] >= 2) {
      const kindLabel =
        PRONUNCIATION_KINDS.find((k) => k.id === topKind[0])?.label ?? topKind[0];
      out.push({
        id: "kind",
        kind: "reviewers",
        value: String(topKind[1]),
        unit: "flags",
        title: `${kindLabel.toLowerCase()} is the most common word-level failure`,
        detail: "WER identifies that a clip was wrong, not which word broke.",
        tone: "warn",
      });
    }

    const ttfa = pooledTtfa(clips, 90);
    if (verdictFor("ttfa_p90_ms", ttfa.value) !== "pass") {
      out.push({
        id: "ttfa",
        kind: "measured",
        value: ttfa.value.toFixed(0),
        unit: "ms TTFA p90",
        title: "time-to-first-audio p90 is above target",
        detail: `Pooled across ${ttfa.nTrials} trials. Target is ${THRESHOLDS.ttfa_p90_ms.warn}ms.`,
        tone: verdictFor("ttfa_p90_ms", ttfa.value) === "fail" ? "bad" : "warn",
      });
    }

    const utmos = mean(clips.map((c) => c.metrics.nat.utmos));
    if (verdictFor("utmos", utmos) !== "pass") {
      out.push({
        id: "utmos",
        kind: "measured",
        value: utmos.toFixed(2),
        unit: "/ 5 UTMOS",
        title: "predicted naturalness is below target",
        detail: `Target is ${THRESHOLDS.utmos.warn}. UTMOS is English-trained and less reliable on other languages.`,
        tone: verdictFor("utmos", utmos) === "fail" ? "bad" : "warn",
      });
    }

    const lufs = clips.map((c) => c.metrics.aud.lufs);
    const spread = Math.max(...lufs) - Math.min(...lufs);
    if (clips.length > 1 && spread > LUFS_SPREAD_WARN_LU) {
      out.push({
        id: "lufs",
        kind: "measured",
        value: spread.toFixed(1),
        unit: "LU spread",
        title: "loudness varies across the corpus",
        detail: `${Math.min(...lufs).toFixed(1)} to ${Math.max(...lufs).toFixed(1)} LUFS. A normalisation fix, not a model one.`,
        tone: "warn",
      });
    }

    // Interleave reviewer and measured findings so the section is never all-WER. Each
    // list keeps its own priority order; we alternate between them, leading with the
    // reviewer side because those are the findings the automated stack cannot produce.
    // Without this the three WER cuts (stress, language, use case) crowd out tone and
    // word-level failures, and the panel reads as a WER report rather than a comparison.
    const reviewer = out.filter((h) => h.kind === "reviewers");
    const measured = out.filter((h) => h.kind === "measured");
    const ordered: Highlight[] = [];
    let ri = 0;
    let mi = 0;
    while (ordered.length < 5 && (ri < reviewer.length || mi < measured.length)) {
      if (ri < reviewer.length) ordered.push(reviewer[ri++]);
      if (ordered.length < 5 && mi < measured.length) ordered.push(measured[mi++]);
    }

    return { highlights: ordered, reviewsInScope };
  }, [clips, aggregates, showLanguage]);

  if (highlights.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Top issues</h2>
        <p className="text-xs text-muted-foreground">
          From the measurements and from the {reviewsInScope} annotation
          {reviewsInScope === 1 ? "" : "s"} covering this cut
          {totalRatings > 0 ? ` (${totalRatings} across the corpus)` : ""}.
        </p>
      </div>
      <Card>
        <CardContent className="divide-y p-0">
          {highlights.map((h) => (
            <div
              key={h.id}
              className={cn(
                "flex flex-col gap-1 border-l-4 p-4 sm:flex-row sm:items-baseline sm:gap-4",
                h.tone === "bad" ? "border-l-red-500/70" : "border-l-amber-500/70",
              )}
            >
              <div className="flex shrink-0 items-baseline gap-1.5 sm:w-52">
                <span
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    h.tone === "bad"
                      ? "text-red-600 dark:text-red-400"
                      : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {h.value}
                </span>
                {h.unit ? (
                  <span className="text-xs text-muted-foreground">{h.unit}</span>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{h.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{h.detail}</p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "shrink-0 self-start text-[10px] font-normal sm:self-center",
                  h.kind === "reviewers"
                    ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
                    : "text-muted-foreground",
                )}
              >
                {h.kind === "reviewers" ? "from reviewers" : "measured"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function ClipDetail({ clip, agg }: { clip: Clip; agg?: ClipAggregate }) {
  const m = clip.metrics;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-mono text-sm">{clip.id}</CardTitle>
          <Badge variant="secondary">{LANGUAGE_NAMES[clip.lang] ?? clip.lang}</Badge>
          <Badge variant="outline">{clip.voice_name}</Badge>
          <Badge variant="outline">{clip.difficulty}</Badge>
          <Badge variant="outline">{clip.use_case.replace(/_/g, " ")}</Badge>
        </div>
        <CardDescription className="text-xs">
          {clip.chars} characters · {clip.audio_s.toFixed(2)}s audio
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <audio src={clip.audio_url} controls preload="none" className="w-full" />

        {/* Intelligibility is best explained by showing the round trip. */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {DIMENSIONS.intelligibility.label}: what was written vs. what the recogniser heard
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Source text
              </div>
              <p className="text-sm">{clip.text}</p>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                ASR hypothesis ({m.int.detected_lang})
              </div>
              <p className="text-sm">{m.int.hypothesis || "–"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
            <span>WER {m.int.wer_pct}%</span>
            <span>CER {m.int.cer_pct}%</span>
            <span>sub {m.int.sub}</span>
            <span>ins {m.int.ins}</span>
            <span>del {m.int.del}</span>
            <span>dur/expected {m.int.dur_expected_ratio}</span>
            <span>{m.int.truncated ? "TRUNCATED" : "not truncated"}</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
              {DIMENSIONS.expressiveness.label}
            </h3>
            <dl className="space-y-1 font-mono text-xs">
              <div className="flex justify-between"><dt>F0 std</dt><dd>{m.nat.f0_semitone_std} st</dd></div>
              <div className="flex justify-between"><dt>F0 mean</dt><dd>{m.nat.f0_mean_hz} Hz</dd></div>
              <div className="flex justify-between"><dt>pauses</dt><dd>{m.nat.n_pauses}</dd></div>
              <div className="flex justify-between">
                <dt>rate</dt>
                <dd>{m.nat.speaking_rate_wps?.toFixed(2) ?? "–"} w/s</dd>
              </div>
            </dl>
            <h3 className="mb-1.5 mt-4 text-xs font-medium text-muted-foreground">
              {DIMENSIONS.naturalness.label}
            </h3>
            <dl className="space-y-1 font-mono text-xs">
              <div className="flex justify-between"><dt>UTMOS</dt><dd>{m.nat.utmos}</dd></div>
            </dl>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
              {DIMENSIONS.performance.label}
            </h3>
            <dl className="space-y-1 font-mono text-xs">
              <div className="flex justify-between"><dt>DNSMOS OVRL</dt><dd>{m.aud.dnsmos_ovrl}</dd></div>
              <div className="flex justify-between"><dt>DNSMOS SIG</dt><dd>{m.aud.dnsmos_sig}</dd></div>
              <div className="flex justify-between"><dt>DNSMOS BAK</dt><dd>{m.aud.dnsmos_bak}</dd></div>
              <div className="flex justify-between"><dt>LUFS</dt><dd>{m.aud.lufs}</dd></div>
              <div className="flex justify-between"><dt>clipping</dt><dd>{m.aud.clipping_pct}%</dd></div>
              <div className="flex justify-between"><dt>SNR</dt><dd>{m.aud.snr_db_est} dB</dd></div>
            </dl>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
              {DIMENSIONS.performance.label}: latency
            </h3>
            <dl className="space-y-1 font-mono text-xs">
              <div className="flex justify-between"><dt>TTFA p90</dt><dd>{m.lat.ttfa_p90_ms} ms</dd></div>
              <div className="flex justify-between"><dt>TTFA p50</dt><dd>{m.lat.ttfa_p50_ms} ms</dd></div>
              <div className="flex justify-between"><dt>total p50</dt><dd>{m.lat.total_p50_ms} ms</dd></div>
              <div className="flex justify-between"><dt>RTF</dt><dd>{m.lat.rtf_p50}</dd></div>
              <div className="flex justify-between"><dt>trials</dt><dd>{m.lat.n_trials}</dd></div>
            </dl>
            {m.lat.n_trials < 3 ? (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Too few trials for a dispersion estimate; treat as a point measurement.
              </p>
            ) : (
              <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                IQR {m.lat.ttfa_iqr_ms} ms across {m.lat.n_trials} trials
              </p>
            )}
          </div>
        </div>

        {/* Human review, reported alongside the metrics, never folded into them. */}
        <div className="rounded-md border p-3">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Human review</h3>
          {!agg ? (
            <p className="text-xs text-muted-foreground">No ratings yet.</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <span>
                <span className="text-muted-foreground">n </span>
                <span className="font-mono">{agg.n}</span>
              </span>

              {agg.human_yes + agg.human_no > 0 ? (
                <span>
                  <span className="text-muted-foreground">sounded 100% human </span>
                  <span className="font-mono">
                    {agg.human_yes}/{agg.human_yes + agg.human_no}
                  </span>
                </span>
              ) : null}
              {Object.entries(agg.tag_counts).length ? (
                <span className="flex flex-wrap gap-1">
                  {Object.entries(agg.tag_counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, n]) => (
                      <Badge key={id} variant="secondary" className="text-[10px]">
                        {TAGS_BY_ID[id]?.label ?? id} ×{n}
                      </Badge>
                    ))}
                </span>
              ) : null}
              {agg.n < 3 ? (
                <span className="w-full text-[10px] text-amber-600 dark:text-amber-400">
                  Low sample. Not enough ratings to draw a conclusion.
                </span>
              ) : null}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


/**
 * Human-generated insights.
 *
 * Nothing on this panel is derivable from the automated stack. Word-level flags say
 * WHICH word failed and how, which no clip-level metric produces. Tone-vs-use-case is
 * a register judgement nothing measures. And the adjudication column is the one that
 * corrects our own instrument: it separates "the model said it wrong" from "the
 * recogniser misheard", which is the difference between a real WER and a raw one.
 */
function HumanFindings({
  clips,
  aggregates,
}: {
  clips: Clip[];
  aggregates: Record<string, ClipAggregate>;
}) {
  const roll = useMemo(() => {
    const kinds: Record<string, number> = {};
    const tones: Record<string, number> = {};
    const delivery: Record<string, number> = {};
    const adj: Record<string, number> = {};
    const accents: Record<string, number> = {};
    let n = 0, cutOff = 0, audioIssue = 0, toneMismatch = 0, toneTotal = 0;
    let humanYes = 0, humanNo = 0;

    for (const c of clips) {
      const a = aggregates[c.id];
      if (!a) continue;
      n += a.n;
      cutOff += a.cut_off_yes;
      audioIssue += a.audio_issue_yes;
      humanYes += a.human_yes;
      humanNo += a.human_no;
      for (const [k, v] of Object.entries(a.accent_counts)) accents[k] = (accents[k] ?? 0) + v;
      for (const [k, v] of Object.entries(a.word_kind_counts)) kinds[k] = (kinds[k] ?? 0) + v;
      for (const [k, v] of Object.entries(a.delivery_counts)) delivery[k] = (delivery[k] ?? 0) + v;
      for (const [k, v] of Object.entries(a.adjudication_counts)) adj[k] = (adj[k] ?? 0) + v;
      const fit = TONE_FIT[c.use_case];
      for (const [k, v] of Object.entries(a.tone_counts)) {
        tones[k] = (tones[k] ?? 0) + v;
        toneTotal += v;
        if (fit && !fit.includes(k) && k !== "other") toneMismatch += v;
      }
    }
    return { kinds, tones, delivery, adj, accents, n, cutOff, audioIssue, toneMismatch, toneTotal, humanYes, humanNo };
  }, [clips, aggregates]);

  if (roll.n === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Human-generated insights</h2>
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No reviews yet.{" "}
          <a href="/rate" className="underline underline-offset-2">Review a set</a> to
          populate this.
        </p>
      </section>
    );
  }

  const label = (list: { id: string; label: string }[], id: string) =>
    list.find((x) => x.id === id)?.label ?? id;

  const bar = (entries: Record<string, number>, list: { id: string; label: string }[]) => {
    const rows = Object.entries(entries).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return rows.map(([id, count]) => (
      <div key={id} className="space-y-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span>{label(list, id)}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">{count}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-amber-500" style={{ width: `${(count / max) * 100}%` }} />
        </div>
      </div>
    ));
  };

  const adjAudio = roll.adj.audio_wrong ?? 0;
  const adjAsr = roll.adj.asr_wrong ?? 0;
  const adjTotal = adjAudio + adjAsr + (roll.adj.unsure ?? 0);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Human-generated insights</h2>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* the instrument-correcting one */}
        {adjTotal > 0 ? (
          <Card className="lg:col-span-2">
            <CardContent className="pt-6">
              <h3 className="text-sm font-medium">Was the flagged error real?</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {adjTotal} word{adjTotal === 1 ? "" : "s"} where the recogniser disagreed
                with the source, adjudicated by ear.
              </p>
              <div className="mt-3 flex flex-wrap gap-6">
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400">
                    {adjAudio}
                  </div>
                  <div className="text-xs text-muted-foreground">the audio really was wrong</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {adjAsr}
                  </div>
                  <div className="text-xs text-muted-foreground">the recogniser misheard</div>
                </div>
                {adjTotal > 0 ? (
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">
                      {Math.round((adjAsr / adjTotal) * 100)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      flagged by raters as non-issues
                    </div>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {roll.humanYes + roll.humanNo > 0 ? (
          <Card>
            <CardContent className="space-y-2 pt-6">
              <h3 className="text-sm font-medium">Sounded 100% human?</h3>
              <div className="flex flex-wrap gap-6 pt-1">
                <div>
                  <div className="text-2xl font-semibold tabular-nums">{roll.humanYes}</div>
                  <div className="text-xs text-muted-foreground">yes</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {roll.humanNo}
                  </div>
                  <div className="text-xs text-muted-foreground">no</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {Math.round((roll.humanNo / (roll.humanYes + roll.humanNo)) * 100)}%
                  </div>
                  <div className="text-xs text-muted-foreground">did not</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {Object.keys(roll.accents).length ? (
          <Card>
            <CardContent className="space-y-2 pt-6">
              <h3 className="text-sm font-medium">Accent</h3>
              <p className="text-xs text-muted-foreground">
                No metric in the stack scores accent. This panel is the only source.
              </p>
              <div className="space-y-2 pt-1">{bar(roll.accents, ACCENT_OPTIONS)}</div>
            </CardContent>
          </Card>
        ) : null}

        {Object.keys(roll.kinds).length ? (
          <Card>
            <CardContent className="space-y-2 pt-6">
              <h3 className="text-sm font-medium">Word-level pronunciation failures</h3>
              <p className="text-xs text-muted-foreground">
                Which kind of word broke. WER cannot localise this.
              </p>
              <div className="space-y-2 pt-1">{bar(roll.kinds, PRONUNCIATION_KINDS)}</div>
            </CardContent>
          </Card>
        ) : null}

        {roll.toneTotal > 0 ? (
          <Card>
            <CardContent className="space-y-2 pt-6">
              <h3 className="text-sm font-medium">Tone heard</h3>
              <p className="text-xs text-muted-foreground">
                {roll.toneMismatch > 0 ? (
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {Math.round((roll.toneMismatch / roll.toneTotal) * 100)}% did not fit the
                    clip&apos;s use case.
                  </span>
                ) : (
                  <>Register matched the use case throughout.</>
                )}
              </p>
              <div className="space-y-2 pt-1">{bar(roll.tones, TONES)}</div>
            </CardContent>
          </Card>
        ) : null}

        {Object.keys(roll.delivery).length ? (
          <Card>
            <CardContent className="space-y-2 pt-6">
              <h3 className="text-sm font-medium">Delivery problems</h3>
              <div className="space-y-2 pt-1">{bar(roll.delivery, DELIVERY_ALL)}</div>
            </CardContent>
          </Card>
        ) : null}

        {roll.cutOff > 0 || roll.audioIssue > 0 ? (
          <Card>
            <CardContent className="space-y-1 pt-6">
              <h3 className="text-sm font-medium">Reported by ear</h3>
              <p className="text-xs text-muted-foreground">
                {roll.cutOff} said the audio cut off words; {roll.audioIssue} heard buzzing,
                garbling or glitches. The truncation detector has flagged 0 clips, so these
                answers are the only check on it.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
