"use client";

import { useMemo, useState } from "react";
import type { Clip } from "@/lib/clips";
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
  DELIVERY_PROBLEMS,
  PRONUNCIATION_KINDS,
  TONES,
  TONE_FIT,
} from "@/lib/annotation";
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
};

const ALL = "__all__";

function Filter({
  label,
  value,
  options,
  onChange,
  format,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  format?: (v: string) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        <option value={ALL}>All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {format ? format(o) : o}
          </option>
        ))}
      </select>
    </div>
  );
}

export function MetricsExplorer({ clips, aggregates, totalRatings }: Props) {
  const [lang, setLang] = useState(ALL);
  const [difficulty, setDifficulty] = useState(ALL);
  const [useCase, setUseCase] = useState(ALL);
  const [selected, setSelected] = useState<string | null>(null);

  const options = useMemo(
    () => ({
      langs: [...new Set(clips.map((c) => c.lang))].sort(),
      difficulties: [...new Set(clips.map((c) => c.difficulty))].sort(),
      useCases: [...new Set(clips.map((c) => c.use_case))].sort(),
    }),
    [clips],
  );

  const filtered = useMemo(
    () =>
      clips.filter(
        (c) =>
          (lang === ALL || c.lang === lang) &&
          (difficulty === ALL || c.difficulty === difficulty) &&
          (useCase === ALL || c.use_case === useCase),
      ),
    [clips, lang, difficulty, useCase],
  );

  const detail = selected ? filtered.find((c) => c.id === selected) ?? null : null;

  const crossLanguage = lang === ALL && options.langs.length > 1;

  return (
    <div className="space-y-8">
      {/* --- Cuts --- */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
        <Filter
          label="Language"
          value={lang}
          options={options.langs}
          onChange={setLang}
          format={(l) => LANGUAGE_NAMES[l] ?? l}
        />
        <Filter
          label="Difficulty"
          value={difficulty}
          options={options.difficulties}
          onChange={setDifficulty}
        />
        <Filter
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                dimension={DIMENSIONS.int.label}
                label="Word error rate"
                value={microWer(filtered).wer.toFixed(2)}
                unit="%"
                verdict={verdictFor("wer_pct", microWer(filtered).wer)}
                caption={`Micro-averaged: ${microWer(filtered).errors} errors / ${microWer(filtered).words} words`}
              />
              <StatTile
                dimension={DIMENSIONS.nat.label}
                label="UTMOS"
                value={mean(filtered.map((c) => c.metrics.nat.utmos)).toFixed(2)}
                unit="/ 5"
                verdict={verdictFor("utmos", mean(filtered.map((c) => c.metrics.nat.utmos)))}
                caption={`F0 spread ${mean(filtered.map((c) => c.metrics.nat.f0_semitone_std)).toFixed(2)} st`}
              />
              <StatTile
                dimension={DIMENSIONS.aud.label}
                label="DNSMOS OVRL"
                value={mean(filtered.map((c) => c.metrics.aud.dnsmos_ovrl)).toFixed(2)}
                unit="/ 5"
                verdict={verdictFor("dnsmos_ovrl", mean(filtered.map((c) => c.metrics.aud.dnsmos_ovrl)))}
                caption={`${mean(filtered.map((c) => c.metrics.aud.lufs)).toFixed(1)} LUFS mean`}
              />
              <StatTile
                dimension={DIMENSIONS.lat.label}
                label="TTFA (p90)"
                value={pooledTtfa(filtered, 90).value.toFixed(0)}
                unit="ms"
                verdict={verdictFor("ttfa_p90_ms", pooledTtfa(filtered, 90).value)}
                caption={`Pooled across ${pooledTtfa(filtered, 90).nTrials} trials`}
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

          {/* --- Per-clip table --- */}
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
                        <TableHead className="text-right">UTMOS</TableHead>
                        <TableHead className="text-right">DNSMOS</TableHead>
                        <TableHead className="text-right">TTFA p90</TableHead>
                        <TableHead className="text-right">Human score</TableHead>
                        <TableHead className="text-right">n</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((c) => {
                        const agg = aggregates[c.id];
                        const isOpen = selected === c.id;
                        return (
                          <TableRow
                            key={c.id}
                            onClick={() => setSelected(isOpen ? null : c.id)}
                            className={cn("cursor-pointer", isOpen && "bg-muted/50")}
                          >
                            <TableCell>
                              <div className="font-mono text-xs">{c.id}</div>
                              <div className="text-xs text-muted-foreground">
                                {LANGUAGE_NAMES[c.lang] ?? c.lang} · {c.difficulty}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {c.stress_category.replace(/_/g, " ")}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.metrics.int.wer_pct.toFixed(1)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.metrics.nat.utmos.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.metrics.aud.dnsmos_ovrl.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.metrics.lat.ttfa_p90_ms.toFixed(0)} ms
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {agg ? agg.mean_overall.toFixed(2) : "\u2013"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {agg?.n ?? 0}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">Select a row for the full breakdown.</p>
          </section>

          {/* --- Detail panel --- */}
          {detail ? <ClipDetail clip={detail} agg={aggregates[detail.id]} /> : null}
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
 * Top issues: the five findings worth leading with for the current cut.
 *
 * Emitted in a fixed order of decision-relevance, taking the first five that clear
 * their threshold. Not sorted by a severity score: ranking a word error rate against a
 * loudness spread against a share of reviewers requires inventing an exchange rate
 * between unlike units, and the result would look objective without being it. The
 * order below is an editorial judgement and is meant to read as one.
 *
 * Reviewer-derived findings come first because they are the ones the automated stack
 * cannot produce, and the two leading ones are specifically about the metrics being
 * wrong — a defect WER scored as perfect, and an error that was our recogniser rather
 * than the voice. Those are the findings that change what a research team does next.
 *
 * Every group is guarded on a minimum denominator. A stress category with nine words
 * in the cut can hit 33% WER on a single substitution, and leading with that would be
 * reporting noise as a finding.
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
      overall.wer > 0.05 ? `${(v / overall.wer).toFixed(1)}× the ${overall.wer.toFixed(1)}% average for this cut` : "against a corpus average of effectively zero";

    // ---- reviewer-derived ----
    const reviewed = clips.filter((c) => (aggregates[c.id]?.n ?? 0) > 0);
    const reviewsInScope = reviewed.reduce((s, c) => s + (aggregates[c.id]?.n ?? 0), 0);
    const flaggedWords = (a: ClipAggregate) =>
      Object.values(a.word_issue_counts).reduce((s, v) => s + v, 0);

    // The thesis of the whole tool: a clip can be word-perfect to an ASR round trip and
    // still be wrong to an ear, because the recogniser normalises away exactly the
    // failures the stress corpus was built to provoke.
    const silent = reviewed.filter(
      (c) => c.metrics.int.wer_pct === 0 && flaggedWords(aggregates[c.id]) > 0,
    );
    if (silent.length > 0) {
      out.push({
        id: "silent",
        kind: "reviewers",
        value: String(silent.length),
        title: `clip${silent.length === 1 ? "" : "s"} scored 0% WER, yet reviewers heard a word fail`,
        detail: `${silent.length} of ${reviewed.length} reviewed clips scored 0.0% word error rate while a reviewer flagged a word inside them. These are invisible to the round trip by construction: the recogniser writes down what the word should have been.`,
        tone: "bad",
      });
    }

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
        unit: "%",
        title: "of flagged errors were our instrument, not the voice",
        detail: `Reviewers adjudicated ${adjTotal} disputed words by ear: ${adjAudio} ${adjAudio === 1 ? "was" : "were"} genuinely wrong in the audio, ${adjAsr} ${adjAsr === 1 ? "was" : "were"} the recogniser mishearing a correct reading. Raw WER charges the model for both.`,
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
        unit: "%",
        title: `${byStress.k.replace(/_/g, " ")} is the worst stress case`,
        detail: `${plural(byStress.errors, "error")} across ${byStress.words} words in ${plural(byStress.count, "clip")} — ${times(byStress.wer)}.`,
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
          unit: "%",
          title: `${LANGUAGE_NAMES[byLang.k] ?? byLang.k} has the highest word error rate`,
          detail: `${plural(byLang.errors, "error")} across ${byLang.words} words. Treat as a lead, not a verdict: WER is read through a recogniser whose own accuracy varies by language, so part of any cross-language gap is the instrument. This corpus has already had one such figure turn out to be exactly that.`,
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
        unit: "%",
        title: `${byUse.k.replace(/_/g, " ")} is the worst use case`,
        detail: `${plural(byUse.errors, "error")} across ${byUse.words} words in ${plural(byUse.count, "clip")} — ${times(byUse.wer)}.`,
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
        unit: "%",
        title: "of clips were read in a tone that did not fit the use case",
        detail: `${toneMismatch} of ${toneTotal} tone judgements landed outside what the use case wants — an urgent read on a healthcare line, say. Nothing in the automated stack scores register.`,
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
        title: `${kindLabel.toLowerCase()} is the most common word-level failure`,
        detail: `Flagged ${topKind[1]} times. WER tells you a clip was wrong; it cannot tell you which word broke or why, which is what a fix has to start from.`,
        tone: "warn",
      });
    }

    const ttfa = pooledTtfa(clips, 90);
    if (verdictFor("ttfa_p90_ms", ttfa.value) !== "pass") {
      out.push({
        id: "ttfa",
        kind: "measured",
        value: ttfa.value.toFixed(0),
        unit: "ms",
        title: "time-to-first-audio p90 is above target",
        detail: `Pooled across ${ttfa.nTrials} trials, against a ${THRESHOLDS.ttfa_p90_ms.warn}ms target. The tail is what a caller notices on a live line, not the median.`,
        tone: verdictFor("ttfa_p90_ms", ttfa.value) === "fail" ? "bad" : "warn",
      });
    }

    const utmos = mean(clips.map((c) => c.metrics.nat.utmos));
    if (verdictFor("utmos", utmos) !== "pass") {
      out.push({
        id: "utmos",
        kind: "measured",
        value: utmos.toFixed(2),
        unit: "/ 5",
        title: "predicted naturalness is below target",
        detail: `Against a ${THRESHOLDS.utmos.warn} target. UTMOS is English-trained, so this figure is weakest exactly where a non-English cut needs it most.`,
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
        unit: "LU",
        title: "loudness varies across the corpus",
        detail: `From ${Math.min(...lufs).toFixed(1)} to ${Math.max(...lufs).toFixed(1)} LUFS. A caller hears this as one clip being quieter than the last, and it is a normalisation fix rather than a model one.`,
        tone: "warn",
      });
    }

    return { highlights: out.slice(0, 5), reviewsInScope };
  }, [clips, aggregates, showLanguage]);

  if (highlights.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Top issues</h2>
        <p className="text-xs text-muted-foreground">
          What this cut is actually saying, from the measurements and from the{" "}
          {reviewsInScope} review{reviewsInScope === 1 ? "" : "s"} covering it
          {totalRatings > 0 ? ` (${totalRatings} across the full corpus)` : ""}.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {highlights.map((h) => (
          <Card
            key={h.id}
            className={cn(
              "border-l-4",
              h.tone === "bad" ? "border-l-red-500/70" : "border-l-amber-500/70",
            )}
          >
            <CardContent className="space-y-2 pt-6">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-normal",
                  h.kind === "reviewers"
                    ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
                    : "text-muted-foreground",
                )}
              >
                {h.kind === "reviewers" ? "from reviewers" : "measured"}
              </Badge>
              <div className="flex items-baseline gap-1">
                <span
                  className={cn(
                    "text-3xl font-semibold tabular-nums",
                    h.tone === "bad"
                      ? "text-red-600 dark:text-red-400"
                      : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {h.value}
                </span>
                {h.unit ? (
                  <span className="text-sm text-muted-foreground">{h.unit}</span>
                ) : null}
              </div>
              <p className="text-sm font-medium leading-snug">{h.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{h.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
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
            {DIMENSIONS.int.label}: what was written vs. what the recogniser heard
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
              {DIMENSIONS.nat.label}
            </h3>
            <dl className="space-y-1 font-mono text-xs">
              <div className="flex justify-between"><dt>UTMOS</dt><dd>{m.nat.utmos}</dd></div>
              <div className="flex justify-between"><dt>F0 std</dt><dd>{m.nat.f0_semitone_std} st</dd></div>
              <div className="flex justify-between"><dt>F0 mean</dt><dd>{m.nat.f0_mean_hz} Hz</dd></div>
              <div className="flex justify-between"><dt>pauses</dt><dd>{m.nat.n_pauses}</dd></div>
              <div className="flex justify-between">
                <dt>rate</dt>
                <dd>{m.nat.speaking_rate_wps?.toFixed(2) ?? "–"} w/s</dd>
              </div>
            </dl>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
              {DIMENSIONS.aud.label}
            </h3>
            <dl className="space-y-1 font-mono text-xs">
              <div className="flex justify-between"><dt>OVRL</dt><dd>{m.aud.dnsmos_ovrl}</dd></div>
              <div className="flex justify-between"><dt>SIG</dt><dd>{m.aud.dnsmos_sig}</dd></div>
              <div className="flex justify-between"><dt>BAK</dt><dd>{m.aud.dnsmos_bak}</dd></div>
              <div className="flex justify-between"><dt>LUFS</dt><dd>{m.aud.lufs}</dd></div>
              <div className="flex justify-between"><dt>peak</dt><dd>{m.aud.peak_dbfs} dBFS</dd></div>
              <div className="flex justify-between"><dt>clipping</dt><dd>{m.aud.clipping_pct}%</dd></div>
              <div className="flex justify-between"><dt>SNR</dt><dd>{m.aud.snr_db_est} dB</dd></div>
            </dl>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
              {DIMENSIONS.lat.label}
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
              <span>
                <span className="text-muted-foreground">mean overall </span>
                <span className="font-mono">{agg.mean_overall.toFixed(2)}</span>
              </span>
              <span>
                <span className="text-muted-foreground">scored below 3 </span>
                <span className="font-mono">{(agg.reject_rate * 100).toFixed(0)}%</span>
              </span>
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
 * What only humans could tell us.
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
    let n = 0, cutOff = 0, audioIssue = 0, toneMismatch = 0, toneTotal = 0;

    for (const c of clips) {
      const a = aggregates[c.id];
      if (!a) continue;
      n += a.n;
      cutOff += a.cut_off_yes;
      audioIssue += a.audio_issue_yes;
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
    return { kinds, tones, delivery, adj, n, cutOff, audioIssue, toneMismatch, toneTotal };
  }, [clips, aggregates]);

  if (roll.n === 0) {
    return (
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">What only humans could tell us</h2>
          <p className="text-xs text-muted-foreground">
            Word-level failures, register, and whether a flagged error was really the
            model or really the recogniser. None of this is derivable from the metrics.
          </p>
        </div>
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
      <div>
        <h2 className="text-sm font-medium">What only humans could tell us</h2>
        <p className="text-xs text-muted-foreground">
          {roll.n} review{roll.n === 1 ? "" : "s"} in this cut. Word-level failures,
          register, and whether a flagged error was really the model or really the
          recogniser. None of this is derivable from the metrics.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* the instrument-correcting one */}
        {adjTotal > 0 ? (
          <Card className="lg:col-span-2">
            <CardContent className="pt-6">
              <h3 className="text-sm font-medium">Was the flagged error real?</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Reviewers adjudicated {adjTotal} word{adjTotal === 1 ? "" : "s"} where the
                recogniser disagreed with the source.
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
                      of flagged errors were our instrument, not the model
                    </div>
                  </div>
                ) : null}
              </div>
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
              <div className="space-y-2 pt-1">{bar(roll.delivery, DELIVERY_PROBLEMS)}</div>
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
