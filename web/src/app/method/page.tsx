import { DEFECT_TAGS, DIMENSIONS, TAG_GROUPS, THRESHOLDS } from "@/lib/taxonomy";
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

export const metadata = {
  title: "Methodology · Soundcheck",
};

const LIMITATIONS = [
  {
    title: "UTMOS and DNSMOS are English-trained",
    body: "Both predictors were trained on English speech. Their absolute values on Spanish, French, German, and Portuguese are not calibrated. Every ranking in this tool is therefore computed within a single language, and the interface refuses to present a cross-language naturalness comparison without a warning.",
  },
  {
    title: "Word and character error rate are measured through an ASR model",
    body: "Nothing reads the audio directly. WER and CER come from transcribing the synthesised speech with Whisper and comparing that transcript to the source text, which means every number is a joint measurement of two systems: how well the voice model spoke, and how well the recogniser listened. A Whisper mistake is indistinguishable from a Gradium mistake in the score. This cuts three ways. Absolute WER is a ceiling on measurable quality rather than a true error count. Cross-language comparison is confounded, because Whisper is materially stronger on English than on the other languages here, so part of any gap between languages is the recogniser. And individual flagged clips need a human to confirm before anyone acts on them: the one action-required intelligibility failure in this corpus, fr-1, is a French clip where the recogniser heard \"sourde la veille\" for \"sourd de la veille\", which is at least as likely to be an ASR error as a synthesis error. Read the transcript against the source on the Samples page before treating any single WER figure as a defect.",
  },
  {
    title: "No ground-truth audio exists",
    body: "There is no reference recording of a human saying these lines, so every metric here is reference-free by necessity. That rules out the distributional metrics (TTSDS2 and similar) that would otherwise be the strongest naturalness signal; they require a natural-speech corpus to compare against.",
  },
  {
    title: "Speaker similarity is not measured",
    body: "Speaker similarity, meaning whether the output sounds like the intended voice, is absent. It only becomes meaningful when evaluating cloned voices against a reference speaker, which is not what this corpus tests.",
  },
  {
    title: "Latency is measured client-side",
    body: "The API returns no timing information of any kind, so time-to-first-audio is measured around the call with a monotonic clock. It therefore includes network round-trip from wherever the harness ran, and cannot be compared across runs on different networks.",
  },
  {
    title: "Anonymous review is spammable",
    body: "There is no login, because requiring one would cost more signal than it protects. Listening time and replay count are recorded with each rating so low-effort submissions can be filtered after the fact, but a determined bad actor could still skew a small sample.",
  },
  {
    title: "Small samples are labelled, not hidden",
    body: "Any figure backed by fewer than three ratings is marked as low-sample rather than quietly rendered. A confident-looking number computed from one opinion is worse than no number.",
  },
];

export default function MethodPage() {
  return (
    <div className="max-w-3xl space-y-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Methodology</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          How subjective impressions about voice get turned into measurable criteria, and
          where that translation breaks down.
        </p>
      </div>

      {/* --- The problem --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">The problem</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          &ldquo;This sounds robotic.&rdquo; &ldquo;The accent feels off.&rdquo; These are
          the sentences people actually say about synthetic voice, and none of them are
          measurable as stated. The usual responses are both unsatisfying: run an expensive
          human MOS panel that is slow and cannot be repeated per model version, or lean on
          automated proxies that produce a clean number which may have nothing to do with
          what users complain about.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This tool does neither. It runs both, on the same clips, and treats{" "}
          <span className="font-medium text-foreground">
            the disagreement between them as the finding
          </span>
          . An automated metric that passes a clip humans reject is not a rounding error;
          it is a gap in coverage, and it tells a research team precisely where their
          current evaluation stack is blind.
        </p>
      </section>

      {/* --- Taxonomy --- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">The defect taxonomy</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Failures are organised into four dimensions. Each is measured independently,
            because a clip can be perfectly intelligible and still unusable.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(DIMENSIONS).map(([key, d]) => (
            <Card key={key}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {d.code}
                  </Badge>
                  <CardTitle className="text-sm">{d.label}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-xs">{d.blurb}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* --- The mapping: this is the core of the methodology --- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Subjective judgement → objective metric</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every checkbox a reviewer can tick is declared alongside the metric that is
            supposed to catch the same defect. This table is the translation layer, and it
            is enforced in code: the rating UI and the scoring harness read the same
            definition.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            The small caps label is how the defect is grouped for reviewers while they
            listen; the Dimension column is which measurement family it belongs to. These
            deliberately differ in one place. Pronunciation failure sits under Naturalness
            for a listener, but it is measured as Intelligibility.
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>What a reviewer reports</TableHead>
                    <TableHead>Dimension</TableHead>
                    <TableHead>Objective counterpart</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DEFECT_TAGS.filter((t) => t.id !== "other").map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{t.label}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {TAG_GROUPS[t.group].label}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{t.note}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                          {t.dimension ? DIMENSIONS[t.dimension].label : "–"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {t.metricKeys.length ? (
                          <div className="space-y-0.5">
                            {t.metricKeys.map((k) => (
                              <div key={k} className="font-mono text-xs">
                                {k}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
                          >
                            no metric
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="text-sm font-medium">The row that matters most is the empty one</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Accent</span> has no objective
            counterpart. Reviewers can hear whether a voice carries the right regional
            accent for its intended market, and nothing in the automated stack scores it.
            Naming that explicitly is more useful than quietly implying the suite is
            complete: it is either a gap that needs a new detector, or a permanent
            human-in-the-loop check, but it should never be assumed covered.
          </p>
        </div>
      </section>

      {/* --- Blind protocol --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Why review happens blind</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Reviewers never see a machine score before submitting. Showing a predicted MOS of
          4.5 before someone forms their own judgement anchors them to it, and the
          agreement you then measure is an artifact of your own interface rather than a
          property of the model. Metrics are structurally excluded from the payload sent to
          the review page, not merely hidden with CSS.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Reviewers are also asked which languages they understand, and are only served
          clips in those languages. Asking someone to judge whether German speech is
          intelligible when they do not speak German generates confident noise.
        </p>
      </section>

      {/* --- Aggregation --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">How figures are aggregated</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Rolling per-clip numbers up into one headline figure is where evaluation tools
          quietly go wrong, so the choices are stated here rather than left implicit. Each
          metric is aggregated the way its own distribution warrants; there is no single
          rule applied to everything.
        </p>
        <div className="space-y-3">
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">
              Word error rate: micro-averaged, never a percentile
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Corpus WER is total errors divided by total reference words, not the mean of
              per-clip rates. A macro-average weights every clip equally regardless of
              length, so a two-word utterance counts as much as a twenty-word one and the
              headline moves when the corpus composition changes rather than when the model
              does. A percentile of WER is not meaningful either: WER is already a ratio,
              and the p90 of a set of ratios answers &ldquo;how bad is the ninth-worst
              clip&rdquo;, which is a corpus property rather than a model property. Tail
              behaviour is reported separately as the single worst clip, which is
              interpretable.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">
              Latency: one percentile over the pooled trials
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Every clip is synthesised several times and each attempt is timed. The corpus
              p90 is computed over all of those measurements pooled together, not by
              averaging each clip&rsquo;s p90. The mean of a set of tail statistics is not a
              percentile of anything and systematically understates the real tail. Pooling
              is sound here because time-to-first-audio is roughly independent of text
              length; it would not be sound for total synthesis time or real-time factor,
              which scale with the utterance and would mix populations.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">
              Predicted MOS and signal metrics: plain means, within a language
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              UTMOS and DNSMOS return one score per clip on a bounded scale, so a mean is
              the honest summary. It is only ever read within a single language, for the
              training-data reason described below.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">Individual clips report their own values</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing on the Samples page or in a per-clip breakdown is aggregated. Each
              clip shows its own WER against its own transcript, and its own latency
              across its own trials, so a single row can always be traced back to the
              measurement that produced it.
            </p>
          </div>
        </div>
      </section>

      {/* --- Thresholds --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Thresholds</h2>
        <p className="text-sm text-muted-foreground">
          Action items on the executive summary are generated by comparing measurements
          against these values. Nothing on that page is hand-written; change the corpus and
          the findings change with it.
        </p>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead className="text-right">Investigate</TableHead>
                    <TableHead className="text-right">Action required</TableHead>
                    <TableHead className="text-right">Direction</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(THRESHOLDS).map(([key, t]) => (
                    <TableRow key={key}>
                      <TableCell className="font-mono text-xs">{key}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{t.warn}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{t.fail}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {t.higherIsWorse ? "lower is better" : "higher is better"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* --- Pipeline --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">How a clip gets here</h2>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1. Corpus.</span> A line is added
            to a manifest with its language, difficulty, use case, and stress category.
          </li>
          <li>
            <span className="font-medium text-foreground">2. Synthesis.</span> The harness
            calls the Gradium API twice per clip: once buffered for a listenable file,
            once streamed and timed for latency. The two are deliberately decoupled.
          </li>
          <li>
            <span className="font-medium text-foreground">3. Scoring.</span> Whisper for the
            ASR round trip, UTMOS for predicted naturalness, DNSMOS P.835 for signal
            quality, librosa and pyloudnorm for prosody and level.
          </li>
          <li>
            <span className="font-medium text-foreground">4. Publication.</span> An export
            step joins metadata to metrics and writes a single JSON file plus lossless
            audio. The site reads that file and nothing else.
          </li>
          <li>
            <span className="font-medium text-foreground">5. Review.</span> Humans rate
            blind here; their input is aggregated by defect category and compared against
            what the metrics detected.
          </li>
        </ol>
        <p className="text-sm text-muted-foreground">
          Audio is served losslessly. Reviewers are asked to judge audio quality directly,
          so compressing it would mean humans and DNSMOS were scoring different signals.
        </p>
      </section>

      {/* --- Limitations --- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Known limitations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Stated plainly, because an evaluation tool that hides its own error bars is not
            an evaluation tool.
          </p>
        </div>
        <div className="space-y-3">
          {LIMITATIONS.map((l) => (
            <div key={l.title} className="rounded-lg border p-4">
              <h3 className="text-sm font-medium">{l.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{l.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
