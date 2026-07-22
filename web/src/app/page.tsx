import Link from "next/link";
import { mean, microWer, pooledTtfa, type Clip } from "@/lib/clips";
import { loadClips } from "@/lib/load-clips";
import { deriveActionItems } from "@/lib/actions";
import { aggregateByClip, isPersisted, listRatings, probesColumnAvailable, type Rating } from "@/lib/ratings";
import { DIMENSIONS, LANGUAGE_NAMES, verdictFor } from "@/lib/taxonomy";
import { StatTile } from "@/components/stat-tile";
import { ReadyToShip } from "@/components/ready-to-ship";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

const SEVERITY_STYLES = {
  fail: "border-red-500/30 bg-red-500/5",
  warn: "border-amber-500/30 bg-amber-500/5",
  info: "border-emerald-500/30 bg-emerald-500/5",
} as const;

const SEVERITY_LABEL = {
  fail: { text: "Action required", cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
  warn: { text: "Investigate", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  info: { text: "Healthy", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
} as const;

function byLanguage(clips: Clip[]) {
  const map = new Map<string, Clip[]>();
  for (const c of clips) map.set(c.lang, [...(map.get(c.lang) ?? []), c]);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export default async function ExecutiveSummaryPage() {
  const { clips, generated_at, languages } = loadClips();

  // Rater input feeds the action list only. It never modifies a measured score.
  let ratings: Rating[] = [];
  try {
    ratings = await listRatings();
  } catch {
    ratings = [];
  }
  const aggregates = aggregateByClip(ratings);
  const actions = deriveActionItems(clips, aggregates);
  const probesOk = await probesColumnAvailable();

  const corpusWer = microWer(clips);
  const worstWer = Math.max(...clips.map((c) => c.metrics.int.wer_pct));
  const meanUtmos = mean(clips.map((c) => c.metrics.nat.utmos));
  const meanDnsmos = mean(clips.map((c) => c.metrics.aud.dnsmos_ovrl));
  const ttfa = pooledTtfa(clips, 90);

  const failCount = actions.filter((a) => a.severity === "fail").length;
  const warnCount = actions.filter((a) => a.severity === "warn").length;

  return (
    <div className="space-y-10">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge variant="outline" className="mb-2 font-mono text-[10px]">
              INTERNAL
            </Badge>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Executive summary
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Objective model performance across {clips.length} clips in{" "}
              {languages.length} languages. Every figure on this page is measured by the
              evaluation harness. None of it is adjusted by human review.
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>Corpus generated</div>
            <div className="font-mono">
              {generated_at.replace("T", " ").replace("+00:00", " UTC")}
            </div>
          </div>
        </div>
      </section>

      {/* --- Topline verdict, derived from the action list below --- */}
      <ReadyToShip
        ready={failCount === 0}
        blockerCount={failCount}
        clipCount={clips.length}
      />

      {/* --- Metrics at a glance --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Model performance</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            dimension={DIMENSIONS.int.label}
            label="Word error rate"
            value={corpusWer.wer.toFixed(2)}
            unit="%"
            verdict={verdictFor("wer_pct", corpusWer.wer)}
            caption={`Micro-averaged: ${corpusWer.errors} errors / ${corpusWer.words} words · worst clip ${worstWer.toFixed(1)}%`}
          />
          <StatTile
            dimension={DIMENSIONS.nat.label}
            label="Mean UTMOS"
            value={meanUtmos.toFixed(2)}
            unit="/ 5"
            verdict={verdictFor("utmos", meanUtmos)}
            caption="Predicted naturalness, English-trained"
          />
          <StatTile
            dimension={DIMENSIONS.aud.label}
            label="Mean DNSMOS OVRL"
            value={meanDnsmos.toFixed(2)}
            unit="/ 5"
            verdict={verdictFor("dnsmos_ovrl", meanDnsmos)}
            caption="Signal quality, independent of wording"
          />
          <StatTile
            dimension={DIMENSIONS.lat.label}
            label="p90 time-to-first-audio"
            value={ttfa.value.toFixed(0)}
            unit="ms"
            verdict={verdictFor("ttfa_p90_ms", ttfa.value)}
            caption={`Pooled across ${ttfa.nTrials} timed trials, client-side`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          UTMOS and DNSMOS are English-trained models. Aggregate figures across languages
          are shown for orientation only; all ranking and comparison happens{" "}
          <span className="font-medium text-foreground">within a language</span>. See the{" "}
          <Link href="/method" className="underline underline-offset-2">
            methodology
          </Link>
          .
        </p>
      </section>

      {/* --- Action items --- */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium text-muted-foreground">Action items</h2>
          <span className="text-xs text-muted-foreground">
            {failCount} requiring action · {warnCount} to investigate
          </span>
        </div>

        <Alert>
          <AlertTitle className="text-sm">These are derived, not written.</AlertTitle>
          <AlertDescription className="text-xs">
            Each item below is produced by comparing measured values against declared
            thresholds. Change the corpus and the list changes with it. Items sourced from
            human review are labelled; they report disagreement without altering any
            score.
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          {actions.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No thresholds breached.
            </p>
          ) : (
            actions.map((a, i) => (
              <div key={i} className={`rounded-lg border p-4 ${SEVERITY_STYLES[a.severity]}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SEVERITY_LABEL[a.severity].cls}`}
                  >
                    {SEVERITY_LABEL[a.severity].text}
                  </span>
                  {a.source === "human-vs-machine" ? (
                    <Badge variant="secondary" className="text-[10px]">
                      human vs. machine
                    </Badge>
                  ) : null}
                  <h3 className="text-sm font-medium">{a.title}</h3>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{a.detail}</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground/80">{a.evidence}</p>
              </div>
            ))
          )}
        </div>
      </section>

      {/* --- Per-language objective breakdown --- */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          By language (objective metrics only)
        </h2>
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
                  {byLanguage(clips).map(([lang, group]) => (
                    <TableRow key={lang}>
                      <TableCell className="font-medium">
                        {LANGUAGE_NAMES[lang] ?? lang}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {lang}
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

      {/* --- Coverage --- */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Review coverage</CardTitle>
            <CardDescription className="text-xs">
              How much human signal currently backs the human-vs-machine findings above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-2xl font-semibold tabular-nums">{ratings.length}</div>
                <div className="text-xs text-muted-foreground">ratings collected</div>
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums">
                  {Object.keys(aggregates).length}/{clips.length}
                </div>
                <div className="text-xs text-muted-foreground">clips with ≥1 rating</div>
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums">
                  {new Set(ratings.map((r) => r.session_id)).size}
                </div>
                <div className="text-xs text-muted-foreground">distinct rater sessions</div>
              </div>
            </div>
            {!probesOk ? (
              <Alert className="border-amber-500/30 bg-amber-500/5">
                <AlertTitle className="text-sm">
                  Probe answers are being discarded
                </AlertTitle>
                <AlertDescription className="text-xs">
                  The database predates the <code className="font-mono">probes</code>{" "}
                  column, so blind-spot answers (how codes were vocalized, whether the
                  accent is right) are dropped on write. Scores and tags are still saved.
                  Run{" "}
                  <code className="font-mono">
                    alter table public.ratings add column if not exists probes jsonb not
                    null default &apos;&#123;&#125;&apos;::jsonb;
                  </code>{" "}
                  and collection resumes immediately, with no redeploy.
                </AlertDescription>
              </Alert>
            ) : null}
            {!isPersisted() ? (
              <Alert className="border-amber-500/30 bg-amber-500/5">
                <AlertTitle className="text-sm">Ratings are not being persisted</AlertTitle>
                <AlertDescription className="text-xs">
                  No database is configured, so submitted ratings live in server memory and
                  are lost on restart. Set <code className="font-mono">SUPABASE_URL</code>{" "}
                  and <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> to
                  collect real data.
                </AlertDescription>
              </Alert>
            ) : null}
            <Link
              href="/rate"
              className="inline-flex items-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
            >
              Contribute a review →
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
