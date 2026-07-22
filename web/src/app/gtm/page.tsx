import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Go-to-market",
};

const SECTIONS = [
  {
    title: "Positioning",
    prompt: "What this is, in one sentence, and what it replaces.",
    seed: "The calibration layer between automated voice metrics and human perception: the thing that tells you which of your metrics to stop trusting.",
  },
  {
    title: "Target users",
    prompt: "Who buys it, who uses it daily, and which one comes first.",
    seed: "Research and model teams first (regression gate across model versions); applied teams shipping voice agents second (pre-launch QA in their own domain).",
  },
  {
    title: "Where it fits",
    prompt: "Where in an existing workflow this sits, and what it displaces.",
    seed: "A release gate. Run the suite per model version, watch the blind-spot list, and know which automated metric stopped tracking reality.",
  },
  {
    title: "Wedge and expansion",
    prompt: "The initial narrow use case, and what it grows into.",
    seed: "The taxonomy generalises; the corpus is what verticalises. Banking, healthcare, and transit each need their own stress cases against the same dimensions.",
  },
  {
    title: "Competitive landscape",
    prompt: "Human MOS panels, in-house eval scripts, generic observability.",
    seed: "",
  },
  {
    title: "Pricing and packaging",
    prompt: "Internal tool, seat-based, or usage-based on clips evaluated.",
    seed: "",
  },
];

export default function GtmPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Badge variant="outline" className="mb-2 font-mono text-[10px]">
          PLACEHOLDER
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Go-to-market</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Scaffolded, not written. The onsite has a dedicated 45-minute go-to-market
          session, so this deserves its own pass rather than filler. The structure below
          marks out what that pass needs to cover.
        </p>
      </div>

      <div className="space-y-3">
        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{s.title}</CardTitle>
              <CardDescription className="text-xs">{s.prompt}</CardDescription>
            </CardHeader>
            <CardContent>
              {s.seed ? (
                <p className="border-l-2 pl-3 text-sm text-muted-foreground">{s.seed}</p>
              ) : (
                <p className="text-sm text-muted-foreground/60 italic">To be written.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
