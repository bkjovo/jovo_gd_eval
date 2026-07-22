import { loadClips } from "@/lib/load-clips";
import { SampleBrowser } from "@/components/sample-browser";

export const metadata = {
  title: "Samples",
};

export default function SamplesPage() {
  const { clips } = loadClips();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Samples</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Gradium-generated audio clips, input text and the ASR transcript that computed
          WER.
        </p>
      </div>

      <SampleBrowser clips={clips} />
    </div>
  );
}
