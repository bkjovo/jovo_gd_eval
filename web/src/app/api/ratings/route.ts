import { NextResponse } from "next/server";
import { insertRating, isPersisted, listRatings, probesDropped, type Rating } from "@/lib/ratings";
import { TAGS_BY_ID } from "@/lib/taxonomy";
import {
  ACCENT_IDS,
  ADJUDICATION_IDS,
  DELIVERY_IDS,
  PRONUNCIATION_KIND_IDS,
  TONE_IDS,
  WORD_ISSUE_IDS,
  type Annotation,
  type WordFlag,
} from "@/lib/annotation";

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

  // Everything below is checked against the declared vocabulary and dropped when it
  // does not match, so an aggregate can never contain a value the taxonomy does not
  // define. Malformed fields are discarded individually rather than failing the whole
  // submission: losing one answer is better than losing the reviewer's whole clip.
  const probes = parseAnnotation(b.probes);

  return {
    session_id,
    clip_id,
    overall,
    probes,
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

  return NextResponse.json({ ok: true, persisted: isPersisted(), probesDropped: probesDropped() });
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


function parseAnnotation(raw: unknown): Annotation {
  if (typeof raw !== "object" || raw === null) return {};
  const b = raw as Record<string, unknown>;
  const out: Annotation = {};

  if (Array.isArray(b.word_flags)) {
    const flags: WordFlag[] = [];
    for (const f of b.word_flags.slice(0, 200)) {
      if (typeof f !== "object" || f === null) continue;
      const g = f as Record<string, unknown>;
      const index = Number(g.index);
      const issue = typeof g.issue === "string" ? g.issue : "";
      if (!Number.isInteger(index) || index < 0 || !WORD_ISSUE_IDS.has(issue as never)) continue;
      const flag: WordFlag = {
        index,
        word: typeof g.word === "string" ? g.word.slice(0, 80) : "",
        issue: issue as WordFlag["issue"],
      };
      // A kind is only meaningful on a pronunciation flag.
      if (issue === "pronunciation" && typeof g.kind === "string" && PRONUNCIATION_KIND_IDS.has(g.kind)) {
        flag.kind = g.kind;
      }
      flags.push(flag);
    }
    if (flags.length) out.word_flags = flags;
  }

  if (typeof b.cut_off === "boolean") out.cut_off = b.cut_off;
  if (typeof b.audio_issue === "boolean") out.audio_issue = b.audio_issue;
  if (typeof b.tone === "string" && TONE_IDS.has(b.tone)) out.tone = b.tone;
  if (typeof b.accent === "string" && ACCENT_IDS.has(b.accent)) out.accent = b.accent;

  if (Array.isArray(b.delivery_problems)) {
    const d = b.delivery_problems.filter(
      (x): x is string => typeof x === "string" && DELIVERY_IDS.has(x),
    );
    if (d.length) out.delivery_problems = d;
  }

  if (typeof b.adjudication === "object" && b.adjudication !== null) {
    const adj: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.adjudication as Record<string, unknown>)) {
      if (/^\d+$/.test(k) && typeof v === "string" && ADJUDICATION_IDS.has(v)) adj[k] = v;
    }
    if (Object.keys(adj).length) out.adjudication = adj;
  }

  return out;
}
