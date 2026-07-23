import { loadClips } from "@/lib/load-clips";
import { microWer, pooledTtfa, type Clip } from "@/lib/clips";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Go-to-market",
};

/**
 * Worst group by micro-averaged WER, guarded so a single substitution in a short
 * category cannot masquerade as a finding. Same guards as the Performance top-issues
 * panel: at least 25 reference words and more than one clip.
 */
function worstBy(clips: Clip[], key: (c: Clip) => string) {
  const groups = new Map<string, Clip[]>();
  for (const c of clips) {
    const k = key(c);
    const list = groups.get(k);
    if (list) list.push(c);
    else groups.set(k, [c]);
  }
  const rows = [...groups.entries()]
    .map(([k, cs]) => ({ k, count: cs.length, ...microWer(cs) }))
    .filter((r) => r.words >= 25 && r.count >= 2)
    .sort((a, b) => b.wer - a.wer);
  return rows[0] ?? null;
}

type Coverage = "covered" | "partial" | "none";

const COVERAGE_ROWS: {
  dimension: string;
  automated: string;
  human: string;
  state: Coverage;
}[] = [
  {
    dimension: "Word accuracy",
    automated: "WER · whisper large-v3",
    human: "tap the word that broke",
    state: "covered",
  },
  {
    dimension: "Naturalness",
    automated: "UTMOS",
    human: "did it sound 100% human",
    state: "covered",
  },
  {
    dimension: "Audio quality",
    automated: "DNSMOS",
    human: "buzzing or glitch flag",
    state: "covered",
  },
  {
    dimension: "Latency",
    automated: "TTFA p90",
    human: "not a listening judgement",
    state: "covered",
  },
  {
    dimension: "Pronunciation kind",
    automated: "partial: WER sees a break, not the kind",
    human: "acronym, code, number, name, homograph",
    state: "partial",
  },
  {
    dimension: "Register / tone",
    automated: "no reference-free metric",
    human: "tone against the use case",
    state: "none",
  },
  {
    dimension: "Accent",
    automated: "no reference-free metric",
    human: "native for its market",
    state: "none",
  },
];

function CoverageDot({ state }: { state: Coverage }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full",
        state === "covered" && "bg-foreground",
        state === "partial" && "bg-amber-500",
        state === "none" && "border border-amber-500 bg-transparent",
      )}
    />
  );
}

export default function GtmPage() {
  const { clips } = loadClips();

  const langs = new Set(clips.map((c) => c.lang)).size;
  const useCases = new Set(clips.map((c) => c.use_case)).size;
  const stressCats = new Set(clips.map((c) => c.stress_category)).size;

  const corpus = microWer(clips);
  const worstStress = worstBy(clips, (c) => c.stress_category);
  // Latency is the one figure the brief allows to compare cleanly across languages; it is
  // computed but only stated where cross-language comparison is not implied.
  void pooledTtfa;

  const stressLabel = worstStress ? worstStress.k.replace(/_/g, " ") : "n/a";
  const stressMult = worstStress ? (worstStress.wer / corpus.wer).toFixed(1) : "n/a";

  return (
    <div className="mx-auto max-w-3xl space-y-12">
      {/* 4.1 Opening */}
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Go-to-market</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Release-gating and pre-deployment QA for teams shipping voice. It is the
          calibration layer between automated voice metrics and human perception: the thing
          that tells you which of your own numbers to stop trusting.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The corpus is {clips.length} clips across {langs} languages, {useCases} use cases
          and {stressCats} stress categories, from proper nouns and account codes to
          currency, dates and code-switched loanwords. Every figure below is measured
          through a named instrument and carries its denominator.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          It measures Gradium models. This is the measurement layer Gradium ships with the
          model, not a third-party benchmark, and a prospect runs their own text against
          their own stress cases to see the defect profile before they commit. Multi-vendor
          scoring is not a current capability.
        </p>
      </div>

      {/* 4.2 The problem */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">How teams check voice today</h2>
        <ul className="space-y-2.5">
          <Bullet term="Listen to a few clips">
            Fast, free, unrepeatable. Catches nothing systematic and cannot gate a release.
          </Bullet>
          <Bullet term="Commission a human MOS panel">
            Accurate on perception, slow and costly per run, so it cannot repeat per model
            version.
          </Bullet>
          <Bullet term="Run an automated script">
            Repeatable and fast, silently blind on register, accent and pronunciation kind,
            and unchecked against its own instrument.
          </Bullet>
        </ul>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The result is that teams learn which of their metrics stopped tracking reality
          from their customers.
        </p>
      </section>

      {/* 4.3 What you get */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">What a run produces</h2>
        <ul className="space-y-2.5">
          <Bullet term="A scored report per model version">
            Four independent dimensions (intelligibility, naturalness, audio quality,
            latency), each with a pass, investigate or action-required verdict against
            stated thresholds.
          </Bullet>
          <Bullet term="A defect breakdown by stress case, use case and language">
            A failure lands on a category an engineer can act on, not a corpus average.
          </Bullet>
          <Bullet term="A per-clip trace">
            Every row leads back to the transcript it was scored against and its error
            breakdown, scored through whisper large-v3.
          </Bullet>
          <Bullet term="A corrected word error rate">
            Recogniser errors separated from model errors.
          </Bullet>
          <Bullet term="A blind-spot list">
            The dimensions in that run no automated metric covered.
          </Bullet>
        </ul>
      </section>

      {/* 4.4 What changes after a run */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">What changes after a run</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Each item is tied to a figure from the current corpus or a documented re-scoring.
        </p>
        <ol className="space-y-4">
          <NumberedFinding n={1} title="It stops trusting a metric it trusted yesterday">
            Scored with whisper small, Portuguese was the weakest language in the set at
            10.68% WER. The same audio re-scored with large-v3 gave 4.70%, several
            transcripts becoming character-identical to the source; the small model had been
            inventing words. A controlled check isolated the effect to non-English: ten
            Portuguese and French clips fell from 36.5% to 14.9%, while English, German and
            Spanish controls held. A team on the naive script files a Portuguese quality bug
            and sends engineers after a defect that was never there.
          </NumberedFinding>
          <NumberedFinding n={2} title="It targets a stress case, not a language">
            The worst stress case on the current corpus is {stressLabel} at{" "}
            {worstStress ? worstStress.wer.toFixed(1) : "n/a"}% WER (
            {worstStress ? worstStress.errors : 0} errors across{" "}
            {worstStress ? worstStress.words : 0} words in{" "}
            {worstStress ? worstStress.count : 0} clips), {stressMult}× the{" "}
            {corpus.wer.toFixed(2)}% corpus average ({corpus.errors} across {corpus.words}{" "}
            words), both measured through whisper large-v3. That is a fix an engineer can
            scope. &ldquo;Our WER is {corpus.wer.toFixed(2)}%&rdquo; is not.
          </NumberedFinding>
          <NumberedFinding n={3} title="It surfaces a defect class nothing was watching">
            Register and accent have no reference-free metric. A run makes their absence
            explicit rather than leaving a team to assume the automated stack had them
            covered.
          </NumberedFinding>
          <NumberedFinding n={4} title="It reports a corrected error rate, not a raw one">
            When the transcript disagrees with the source, a reviewer rules on those words:
            model error, or recogniser error. On cs-07-fr the script reads{" "}
            <span className="font-medium text-foreground">voici 20 pour cent</span> and
            Whisper wrote <span className="font-medium text-foreground">voici 20%</span>,
            charging three errors against a correct reading.
          </NumberedFinding>
        </ol>
      </section>

      {/* 4.5 Coverage and blind spots: the signature section */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">What is measured, and what is not</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Which dimensions have an objective metric, which are partly covered, and which
          have none. The rows with no automated metric are what a review layer exists to
          catch; they are also the rows a buyer is most likely to assume are covered.
        </p>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Dimension</TableHead>
                    <TableHead>Automated metric</TableHead>
                    <TableHead>Human review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COVERAGE_ROWS.map((r) => (
                    <TableRow
                      key={r.dimension}
                      className={cn(r.state === "none" && "bg-amber-500/5")}
                    >
                      <TableCell>
                        <CoverageDot state={r.state} />
                      </TableCell>
                      <TableCell className="text-sm font-medium">{r.dimension}</TableCell>
                      <TableCell
                        className={cn(
                          "text-xs",
                          r.state === "covered"
                            ? "font-mono text-muted-foreground"
                            : "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {r.automated}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.human}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          Filled dot: an objective metric covers it. Amber dot: partly, the metric sees that
          a word broke but not which one or why. Hollow dot: no reference-free metric exists,
          and the human answer is the only source.
        </p>
      </section>

      {/* 4.6 Against other approaches */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Against other approaches</h2>
        <ul className="space-y-2.5">
          <Bullet term="Human MOS panels and annotation vendors">
            Strong on perceptual fidelity and rater scale. Cost and turnaround per run keep
            them from gating a release.
          </Bullet>
          <Bullet term="In-house eval scripts">
            Free and already integrated. Nobody checks whether the metric still tracks
            perception, which is the failure the re-scoring demonstrates.
          </Bullet>
          <Bullet term="Academic benchmark suites">
            Rigorous and comparable. They need a natural-speech reference corpus, which
            production text does not have; reference-free operation is the wedge.
          </Bullet>
          <Bullet term="Generic LLM observability platforms">
            Good at pipeline integration. No audio primitives: no ASR round-trip, no
            predicted MOS, no prosody statistics, no stress-case corpus.
          </Bullet>
        </ul>
        <p className="text-sm leading-relaxed text-foreground">
          The differentiation is three words: reference-free, stress-stratified,
          calibration-aware.
        </p>
      </section>

      {/* 4.7 Where this does not fit */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Where this does not fit</h2>
        <ul className="space-y-2.5">
          <Bullet term="Voice cloning against a reference speaker">
            There is no speaker-similarity scoring, so cloning fidelity is out of scope.
          </Bullet>
          <Bullet term="Cross-language quality ranking">
            Predicted-MOS values are uncalibrated outside English, so this ranks within a
            language, not across one.
          </Bullet>
          <Bullet term="Comparing latency across environments">
            Latency is measured client-side and includes network round-trip, so runs on
            different networks are not comparable.
          </Bullet>
        </ul>
      </section>

      {/* 4.8 Packaging and next step */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Packaging</h2>
        <ol className="space-y-4">
          <NumberedFinding n={1} title="Bundled with the platform">
            The stratified corpus, the scoring harness and the per-version report available
            to teams building on Gradium. A reason to build here, not a line item.
          </NumberedFinding>
          <NumberedFinding n={2} title="Bring your own corpus">
            A prospect supplies their own script, in their own language, against their own
            stress cases, and gets a scored report. Metered by clips evaluated. The
            pre-sales motion and the expansion path at once.
          </NumberedFinding>
          <NumberedFinding n={3} title="Continuous gating">
            Scheduled runs per model version with a diff against the previous one, for teams
            that have shipped.
          </NumberedFinding>
        </ol>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The open question is whether tier two is a product line or a pre-sales motion. It
          depends on whether prospects will bring their own corpus, which is unvalidated;
          naming that is the honest answer at this stage.
        </p>
        <p className="text-sm leading-relaxed text-foreground">
          The next step is a run on a prospect&rsquo;s own text: their script, their
          languages, their stress cases, scored the same way as the corpus above.
        </p>
      </section>
    </div>
  );
}

function Bullet({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <li className="text-sm leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">{term}.</span> {children}
    </li>
  );
}

function NumberedFinding({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums text-muted-foreground">
        {n}
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
