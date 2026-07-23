import { loadClips } from "@/lib/load-clips";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Go-to-market",
};

const LEDGER: [string, string][] = [
  [
    "Reference-free scoring",
    "Rules out distributional metrics like TTSDS2, which need a natural-speech corpus.",
  ],
  [
    "Clips chosen for difficulty, not volume",
    "Not representative of average traffic. Scores here are deliberately worse than production.",
  ],
  [
    "Blind human review, metrics never shown",
    "Slower per rating. Cannot speed reviewers up by priming them.",
  ],
  [
    "Scoped to Gradium models",
    "Not a neutral benchmark. No vendor comparison.",
  ],
  [
    "Ranking within a language only",
    "UTMOS and DNSMOS are English-trained, so no single cross-language number exists.",
  ],
  [
    "Limitations published in full",
    "Hands a competitor the list.",
  ],
];

function Choice({
  label,
  question,
  answer,
  chose,
  cost,
  children,
}: {
  label: string;
  question: string;
  answer: string;
  chose: string;
  cost: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h2 className="text-lg font-medium">{label}</h2>
      <p className="text-xs text-muted-foreground">{question}</p>
      <p className="text-sm leading-relaxed text-foreground">{answer}</p>
      {children}
      <p className="text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Chose</span> {chose}{" "}
        <span className="font-medium text-foreground">Cost:</span> {cost}
      </p>
    </section>
  );
}

export default function GtmPage() {
  const { clips } = loadClips();

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Go-to-market</h1>
      </div>

      <Choice
        label="Positioning"
        question="What this is, in one line."
        answer="Reference-free evaluation for voice models: it tells you which of your own metrics to stop trusting."
        chose="a calibration layer over a benchmark."
        cost="no headline score, no league table, nothing to screenshot."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          One example: <code className="font-mono text-xs">whisper small</code> put
          Portuguese at 10.68% WER; <code className="font-mono text-xs">large-v3</code> on
          identical audio gave 4.70%. The defect was the instrument.
        </p>
      </Choice>

      <Choice
        label="Target users"
        question="Who buys it, and who comes first."
        answer="Teams putting a voice agent in front of customers, who today sign off by listening to a few clips. Model teams gating checkpoints second."
        chose="depth for a narrow technical buyer."
        cost="unusable for anyone wanting a quick quality read on one clip."
      />

      <Choice
        label="Where it fits"
        question="Where it sits, and what it replaces."
        answer="A release gate. Runs before launch and between model versions, and replaces ad-hoc listening sessions and one-off MOS panels."
        chose="pre-deployment batch."
        cost="nothing runs on live traffic. This is not monitoring."
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-medium">Every choice, and what it cost</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The evaluation runs on {clips.length} clips.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[38%] whitespace-normal">Decision</TableHead>
                <TableHead className="whitespace-normal">What it cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {LEDGER.map(([decision, cost]) => (
                <TableRow key={decision}>
                  <TableCell className="align-top text-sm font-medium whitespace-normal">
                    {decision}
                  </TableCell>
                  <TableCell className="align-top text-sm whitespace-normal text-muted-foreground">
                    {cost}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
