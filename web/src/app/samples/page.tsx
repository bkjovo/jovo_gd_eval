import Link from "next/link";
import { loadClips } from "@/lib/load-clips";
import { SampleBrowser } from "@/components/sample-browser";

export const metadata = {
  title: "Samples · Soundcheck",
};

export default function SamplesPage() {
  const { clips } = loadClips();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Samples</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every clip in the corpus with its audio and the ASR transcript that word error
          rate is computed from. This is the page to open when a WER figure looks wrong:
          the metric is only as good as the recogniser, and reading the two texts together
          is how you tell a synthesis error from a transcription one. See the{" "}
          <Link href="/method" className="underline underline-offset-2">
            methodology
          </Link>{" "}
          for why that distinction matters.
        </p>
      </div>

      <SampleBrowser clips={clips} />
    </div>
  );
}
