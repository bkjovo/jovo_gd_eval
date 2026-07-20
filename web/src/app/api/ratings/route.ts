import { NextResponse } from "next/server";
import { insertRating, isPersisted, listRatings, type Rating } from "@/lib/ratings";
import { TAGS_BY_ID } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

/** Reject anything malformed at the boundary; the store assumes valid rows. */
function parseRating(body: unknown): Rating | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "body must be an object" };
  const b = body as Record<string, unknown>;

  const session_id = typeof b.session_id === "string" ? b.session_id.slice(0, 64) : "";
  const clip_id = typeof b.clip_id === "string" ? b.clip_id.slice(0, 64) : "";
  if (!session_id || !clip_id) return { error: "session_id and clip_id are required" };

  const overall = Number(b.overall);
  if (!Number.isInteger(overall) || overall < 1 || overall > 5) {
    return { error: "overall must be an integer 1-5" };
  }

  const rawTags = Array.isArray(b.defect_tags) ? b.defect_tags : [];
  const defect_tags = rawTags
    .filter((t): t is string => typeof t === "string")
    .filter((t) => t in TAGS_BY_ID);

  return {
    session_id,
    clip_id,
    overall,
    defect_tags,
    other_text:
      typeof b.other_text === "string" && b.other_text.trim()
        ? b.other_text.trim().slice(0, 500)
        : null,
    listened_ms: Number.isFinite(Number(b.listened_ms)) ? Math.max(0, Math.round(Number(b.listened_ms))) : 0,
    replays: Number.isFinite(Number(b.replays)) ? Math.max(0, Math.round(Number(b.replays))) : 0,
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = parseRating(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    await insertRating(parsed);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "write failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, persisted: isPersisted() });
}

export async function GET() {
  try {
    const ratings = await listRatings();
    return NextResponse.json({ ratings, persisted: isPersisted() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "read failed" },
      { status: 502 },
    );
  }
}
