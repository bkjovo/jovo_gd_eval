import { type RaterClip } from "@/lib/clips";
import { loadClips } from "@/lib/load-clips";
import { Rater } from "@/components/rater";

export const metadata = {
  title: "Annotate",
};

export default function RatePage() {
  const { clips } = loadClips();

  // Strip metrics before they cross to the client. The blind flow must not be able to
  // render a machine score even by mistake.
  const raterClips: RaterClip[] = clips.map(({ metrics: _metrics, ...rest }) => rest);

  return <Rater clips={raterClips} />;
}
