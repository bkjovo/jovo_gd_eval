import { NextResponse } from "next/server";
import { loadClips } from "@/lib/load-clips";

export const dynamic = "force-dynamic";

/**
 * The ASR transcript for one clip, and nothing else.
 *
 * Adjudication (pass 3) needs the transcript to ask "was the audio wrong, or did the
 * recogniser mishear?". It deliberately does NOT return UTMOS, DNSMOS or any quality
 * score. A reviewer adjudicates a transcript without ever seeing a machine quality
 * judgement, so nothing they are shown can anchor the score they just gave.
 *
 * wer_pct is included because the flow needs to know whether there is anything to
 * adjudicate at all. It is a count of disagreements, not a verdict on the audio.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { clips } = loadClips();
  const clip = clips.find((c) => c.id === id);
  if (!clip) return NextResponse.json({ error: "unknown clip" }, { status: 404 });

  return NextResponse.json({
    id: clip.id,
    hypothesis: clip.metrics.int.hypothesis,
    wer_pct: clip.metrics.int.wer_pct,
  });
}
