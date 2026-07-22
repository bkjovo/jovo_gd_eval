import { NextResponse } from "next/server";
import { loadClips } from "@/lib/load-clips";

export const dynamic = "force-dynamic";

/**
 * Objective metrics for a single clip, fetched by the review flow ONLY after that
 * clip's rating has been submitted.
 *
 * This exists so the reveal can show machine-vs-human without the rating page ever
 * receiving metrics up front. Blindness is then a property of the architecture rather
 * than of remembering not to render something: /rate is served a payload with the
 * metrics stripped, so there is nothing to leak even by mistake.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { clips } = loadClips();
  const clip = clips.find((c) => c.id === id);
  if (!clip) {
    return NextResponse.json({ error: "unknown clip" }, { status: 404 });
  }

  const m = clip.metrics;
  return NextResponse.json({
    id: clip.id,
    lang: clip.lang,
    stress_category: clip.stress_category,
    difficulty: clip.difficulty,
    metrics: {
      wer_pct: m.int.wer_pct,
      cer_pct: m.int.cer_pct,
      truncated: m.int.truncated,
      hypothesis: m.int.hypothesis,
      utmos: m.nat.utmos,
      f0_semitone_std: m.nat.f0_semitone_std,
      dnsmos_ovrl: m.aud.dnsmos_ovrl,
      ttfa_p50_ms: m.lat.ttfa_p50_ms,
    },
  });
}
