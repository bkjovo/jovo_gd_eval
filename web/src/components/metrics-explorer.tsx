"use client";

import { useMemo, useState } from "react";
import type { Clip } from "@/lib/clips";
import { mean, microWer, pooledTtfa } from "@/lib/clips";
import type { ClipAggregate } from "@/lib/ratings";
import {
  ACCENT_PROBE,
  DEFECT_TAGS,
  DIMENSIONS,
  LANGUAGE_NAMES,
  PROBES,
  TAGS_BY_ID,
  verdictFor,
} from "@/lib/taxonomy";
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

  // Rater tag counts across the filtered subset only.
  const tagSummary = useMemo(() => {
    const counts = new Map<string, number>();
    let ratingsInScope = 0;
    for (const c of filtered) {
      const agg = aggregates[c.id];
      if (!agg) continue;
      ratingsInScope += agg.n;
      for (const [tag, n] of Object.entries(agg.tag_counts)) {
        counts.set(tag, (counts.get(tag) ?? 0) + n);
      }
    }
    const rows = DEFECT_TAGS.map((t) => ({ tag: t, count: counts.get(t.id) ?? 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
    return { rows, ratingsInScope, max: Math.max(1, ...rows.map((r) => r.count)) };
  }, [filtered, aggregates]);

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

          {/* --- Top rater issues --- */}
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-medium">Top issues identified by raters</h2>
              <p className="text-xs text-muted-foreground">
                {tagSummary.ratingsInScope} rating
                {tagSummary.ratingsInScope === 1 ? "" : "s"} in this cut
                {totalRatings > 0 ? ` · ${totalRatings} across the full corpus` : ""}. Each
                issue is shown next to the objective metric that should detect it.
              </p>
            </div>

            {tagSummary.rows.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {tagSummary.ratingsInScope === 0 ? (
                  <>
                    No human reviews for these clips yet.{" "}
                    <a href="/rate" className="underline underline-offset-2">
                      Add one
                    </a>{" "}
                    to populate this panel.
                  </>
                ) : (
                  // Reviews exist and nobody flagged anything. That is a result, not an
                  // empty state, and it should not read like missing data.
                  <>
                    {tagSummary.ratingsInScope} review
                    {tagSummary.ratingsInScope === 1 ? "" : "s"} in this cut, and no defects
                    were flagged on any of them.
                  </>
                )}
              </p>
            ) : (
              <Card>
                <CardContent className="space-y-3 pt-6">
                  {tagSummary.rows.map(({ tag, count }) => (
                    <div key={tag.id} className="space-y-1.5">
                      <div className="flex items-baseline gap-2 text-sm">
                        <span className="font-medium">{tag.label}</span>
                        {tag.metricKeys.length === 0 && tag.id !== "other" ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
                          >
                            no metric detects this
                          </Badge>
                        ) : (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {tag.metricKeys.join(" · ")}
                          </span>
                        )}
                        <span className="ml-auto tabular-nums text-muted-foreground">
                          {count}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            tag.metricKeys.length === 0 && tag.id !== "other"
                              ? "bg-amber-500"
                              : "bg-foreground/70",
                          )}
                          style={{ width: `${(count / tagSummary.max) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>

          {/* --- Blind-spot probe answers: the signal no metric produces --- */}
          <ProbeSummary clips={filtered} aggregates={aggregates} />

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
 * What reviewers answered on the targeted probes, aggregated.
 *
 * This is the part of the dashboard that no automated metric could ever fill in. Every
 * answer here describes HOW something was vocalized, or whether the accent is right,
 * both of which are invisible to a WER round-trip. Non-expected answers are surfaced
 * first because those are the actionable ones.
 */
function ProbeSummary({
  clips,
  aggregates,
}: {
  clips: Clip[];
  aggregates: Record<string, ClipAggregate>;
}) {
  const allProbes = { ...PROBES, [ACCENT_PROBE.id]: ACCENT_PROBE };

  const rows = useMemo(() => {
    const totals: Record<string, Record<string, number>> = {};
    for (const c of clips) {
      const agg = aggregates[c.id];
      if (!agg) continue;
      for (const [pid, counts] of Object.entries(agg.probe_counts ?? {})) {
        for (const [value, n] of Object.entries(counts)) {
          ((totals[pid] ??= {})[value] ??= 0);
          totals[pid][value] += n;
        }
      }
    }
    return Object.entries(totals)
      .map(([pid, counts]) => {
        const probe = allProbes[pid];
        if (!probe) return null;
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const options = probe.options
          .map((o) => ({ ...o, n: counts[o.value] ?? 0 }))
          .filter((o) => o.n > 0)
          .sort((a, b) => b.n - a.n);
        const offExpected = options
          .filter((o) => !o.expected && o.value !== "unsure")
          .reduce((a, o) => a + o.n, 0);
        return { probe, options, total, offExpected };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.offExpected / b.total - a.offExpected / a.total);
  }, [clips, aggregates, allProbes]);

  if (rows.length === 0) {
    return (
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Blind spots: what only humans could tell us</h2>
          <p className="text-xs text-muted-foreground">
            How codes, acronyms and emphasis were actually vocalized, and whether the accent
            is right. No reference-free metric produces any of this.
          </p>
        </div>
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No probe answers yet.{" "}
          <a href="/rate" className="underline underline-offset-2">
            Review a set
          </a>{" "}
          to populate this.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Blind spots: what only humans could tell us</h2>
        <p className="text-xs text-muted-foreground">
          How codes, acronyms and emphasis were actually vocalized, and whether the accent is
          right. No reference-free metric produces any of this. Sorted by how often the answer
          was not what a production system would want.
        </p>
      </div>
      <Card>
        <CardContent className="space-y-5 pt-6">
          {rows.map(({ probe, options, total, offExpected }) => (
            <div key={probe.id} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-medium">{probe.question}</h3>
                <span className="ml-auto text-xs text-muted-foreground">
                  n={total}
                  {offExpected > 0 ? (
                    <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">
                      {Math.round((offExpected / total) * 100)}% not as wanted
                    </span>
                  ) : null}
                </span>
              </div>
              {options.map((o) => (
                <div key={o.value} className="space-y-1">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className={cn(!o.expected && o.value !== "unsure" && "font-medium")}>
                      {o.label}
                    </span>
                    {o.expected ? (
                      <span className="text-[10px] text-muted-foreground">wanted</span>
                    ) : null}
                    <span className="ml-auto tabular-nums text-muted-foreground">{o.n}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        o.expected
                          ? "bg-emerald-500"
                          : o.value === "unsure"
                            ? "bg-muted-foreground/40"
                            : "bg-amber-500",
                      )}
                      style={{ width: `${(o.n / total) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
              {total < 3 ? (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  Low sample. Not enough answers to draw a conclusion.
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
