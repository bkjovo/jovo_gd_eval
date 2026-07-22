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
  title: "Methodology",
};

const LIMITATIONS = [
  {
    title: "UTMOS and DNSMOS are English-trained",
    body: "Absolute values on Spanish, French, German and Portuguese are uncalibrated. All ranking is computed within a single language.",
  },
  {
    title: "WER and CER are measured through an ASR model",
    body: "Nothing reads the audio directly. Both numbers are a joint measurement of the voice model and the recogniser, and a Whisper error is indistinguishable from a Gradium error in the score. Absolute WER is a ceiling on measurable quality, not an error count. Cross-language comparison is confounded because Whisper is stronger on English than on the other four languages.",
  },
  {
    title: "No ground-truth audio exists",
    body: "There is no reference recording of these lines, so every metric is reference-free. This rules out distributional metrics such as TTSDS2, which require a natural-speech corpus to compare against.",
  },
  {
    title: "Speaker similarity is not measured",
    body: "It is only meaningful when evaluating cloned voices against a reference speaker, which this corpus does not test.",
  },
  {
    title: "Latency is measured client-side",
    body: "The API returns no timing data, so time-to-first-audio is measured around the call with a monotonic clock. It includes network round-trip and is not comparable across runs on different networks.",
  },
  {
    title: "Anonymous review is spammable",
    body: "There is no login. Listening time and replay count are recorded with each rating so low-effort submissions can be filtered after the fact.",
  },
  {
    title: "Small samples are labelled, not hidden",
    body: "Any figure backed by fewer than three ratings is marked low-sample.",
  },
];

const AGGREGATION = [
  {
    title: "Word error rate: micro-averaged, never a percentile",
    body: "Corpus WER is total errors divided by total reference words, not the mean of per-clip rates. A macro-average weights a two-word utterance the same as a twenty-word one, so the headline moves with corpus composition rather than with the model. A percentile of WER is not meaningful either: WER is already a ratio. Tail behaviour is reported as the single worst clip.",
  },
  {
    title: "Latency: one percentile over pooled trials",
    body: "Every clip is synthesised several times and each attempt timed. The corpus p90 is computed over all measurements pooled, not by averaging per-clip p90s, which is not a percentile of anything and understates the tail. Pooling is valid because time-to-first-audio is roughly independent of text length. It would not be valid for total synthesis time or real-time factor.",
  },
  {
    title: "Predicted MOS and signal metrics: plain means, within a language",
    body: "UTMOS and DNSMOS return one bounded score per clip, so a mean is the honest summary.",
  },
  {
    title: "Individual clips report their own values",
    body: "Nothing on the Samples page or in a per-clip breakdown is aggregated, so any row traces back to the measurement that produced it.",
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
          &ldquo;This sounds robotic.&rdquo; &ldquo;The accent feels off.&rdquo; Neither is
          measurable as stated. The two standard answers are a human MOS panel, which is
          slow and cannot be repeated per model version, or automated proxies, which
          produce a clean number that may not track what users complain about.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This tool runs both on the same clips and treats{" "}
          <span className="font-medium text-foreground">the disagreement as the finding</span>
          . A metric that passes a clip humans reject is a gap in coverage, and it locates
          where the evaluation stack is blind.
        </p>
      </section>

      {/* --- Taxonomy --- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">The defect taxonomy</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Four dimensions, measured independently. A clip can be perfectly intelligible
            and still unusable.
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

      {/* --- The mapping --- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Subjective judgement to objective metric</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every defect a reviewer can report is declared alongside the metric meant to
            catch it. The rating UI and the scoring harness read the same definition. The
            small caps label is how the defect is grouped for a listener; Dimension is the
            measurement family. They differ in one place: pronunciation failure sits under
            Naturalness for a listener but is measured as Intelligibility.
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
            accent for its market; nothing in the automated stack scores it. It is either a
            gap needing a new detector or a permanent human check, but it should not be
            assumed covered.
          </p>
        </div>
      </section>

      {/* --- Blind protocol --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Why review happens blind</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Reviewers never see a machine score, before or after submitting. A predicted MOS
          shown first anchors the judgement; shown after, it calibrates the reviewer across
          a session. Either way the agreement measured is an artifact of the interface.
          Metrics are excluded from the payload sent to the review page rather than hidden
          in the UI, and the transcript endpoint returns no quality scores.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Reviewers select the languages they understand and are served only those clips.
        </p>
      </section>

      {/* --- Aggregation --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">How figures are aggregated</h2>
        <p className="text-sm text-muted-foreground">
          Each metric is aggregated the way its own distribution warrants. There is no
          single rule applied to everything.
        </p>
        <div className="space-y-3">
          {AGGREGATION.map((a) => (
            <div key={a.title} className="rounded-lg border p-4">
              <h3 className="text-sm font-medium">{a.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{a.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --- The measurement chain --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">The measurement chain</h2>
        <p className="text-sm text-muted-foreground">
          Intelligibility is measured through a recogniser and a text normalizer, both part
          of the instrument. Three figures on this corpus that looked like model defects
          were properties of our own tooling.
        </p>

        <div className="space-y-3">
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">Recogniser size changed the answer</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Scored with <code className="font-mono text-xs">whisper small</code>,
              Portuguese came out at 10.68% WER, the weakest language. The identical audio
              re-scored with <code className="font-mono text-xs">large-v3</code> gave 4.70%.
              Several Portuguese transcripts became character-identical to the source; the
              small model had been inventing words, transcribing{" "}
              <span className="font-medium text-foreground">xarope</span> as{" "}
              <span className="font-medium text-foreground">syrup</span>. A controlled check
              confirmed the effect was specific to non-English: ten Portuguese and French
              clips improved from 36.5% to 14.9%, while three English, German and Spanish
              controls did not move. Scoring defaults to{" "}
              <code className="font-mono text-xs">large-v3</code> and every row records the
              recogniser that produced it.
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">Normalization, and why raw is reported too</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Text is normalized before alignment with OpenAI&apos;s Whisper normalizers:{" "}
              <code className="font-mono text-xs">EnglishTextNormalizer</code> for English,{" "}
              <code className="font-mono text-xs">BasicTextNormalizer</code> otherwise. One
              rule is added on top, splitting digit-bearing alphanumeric tokens into
              characters, because Whisper returns{" "}
              <code className="font-mono text-xs">A739K2</code> as one token in French and
              German but as <code className="font-mono text-xs">A 739 K2</code> in English,
              Spanish and Portuguese for identical input. Raw and normalized are both
              published so the size of the correction stays visible.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              There is no community standard. The multilingual ASR leaderboard documents its
              English normalization and not its multilingual one, and published work finds
              Whisper&apos;s normalizer corrupts non-Latin scripts.
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">
              Reviewers adjudicate the recogniser, and it is usually wrong
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              When the transcript disagrees with the source, the reviewer is asked, last and
              on those words only, whether the audio or the transcript was wrong. Most
              disputes resolve against the instrument. On{" "}
              <code className="font-mono text-xs">cs-07-fr</code> the source reads{" "}
              <span className="font-medium text-foreground">voici 20 pour cent</span> and
              Whisper wrote <span className="font-medium text-foreground">voici 20%</span>,
              charging the model three word errors for a correct reading. That verdict is
              what separates a corrected WER from a raw one.
            </p>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <h3 className="text-sm font-medium">
              Blind spot: how formatted content is vocalized
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              WER cannot tell whether{" "}
              <code className="font-mono text-xs">A739K2</code> was read character by
              character or chunked, or whether{" "}
              <code className="font-mono text-xs">500 mg</code> became
              &ldquo;milligrams&rdquo; or &ldquo;em gee&rdquo;. All of those transcribe back
              to the same string.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              The review flow asks directly. Reviewers tap the word that went wrong and say
              what kind of failure it was: a mispronounced code, a botched acronym, a
              homograph read the wrong way, a mangled name. No clip-level metric produces
              that.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Accent is only partly covered.</span>{" "}
              A code-switched word can be flagged for a wrong accent. Whether the voice as a
              whole sounds native for its market is not collected: a per-clip question
              answered the same way fifty times produces agreement, not information.
            </p>
          </div>
        </div>
      </section>

      {/* --- Thresholds --- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Thresholds</h2>
        <p className="text-sm text-muted-foreground">
          Verdicts and derived findings come from comparing measurements against these
          values. Change the corpus and the findings change with it.
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
            <span className="font-medium text-foreground">1. Corpus.</span> A line enters a
            manifest with its language, difficulty, use case and stress category.
          </li>
          <li>
            <span className="font-medium text-foreground">2. Synthesis.</span> Two Gradium
            API calls per clip: one buffered for a listenable file, one streamed and timed
            for latency.
          </li>
          <li>
            <span className="font-medium text-foreground">3. Scoring.</span> Whisper for the
            ASR round trip, UTMOS for predicted naturalness, DNSMOS P.835 for signal
            quality, librosa and pyloudnorm for prosody and level.
          </li>
          <li>
            <span className="font-medium text-foreground">4. Publication.</span> An export
            step joins metadata to metrics and writes one JSON file plus lossless audio. The
            site reads that file and nothing else.
          </li>
          <li>
            <span className="font-medium text-foreground">5. Review.</span> Humans annotate
            blind; their input is aggregated and compared against what the metrics detected.
          </li>
        </ol>
        <p className="text-sm text-muted-foreground">
          Audio is served losslessly. Reviewers judge audio quality directly, so compressing
          it would mean humans and DNSMOS were scoring different signals.
        </p>
      </section>

      {/* --- Limitations --- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Known limitations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            An evaluation tool that hides its own error bars is not an evaluation tool.
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
