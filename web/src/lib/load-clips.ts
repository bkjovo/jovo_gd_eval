import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { ClipsPayload } from "./clips";

/**
 * Reads the exporter's output. Kept apart from clips.ts so client components can
 * import the shared types and helpers without dragging node:fs into the bundle.
 */
export function loadClips(): ClipsPayload {
  const p = path.join(process.cwd(), "public", "data", "clips.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")) as ClipsPayload;
}
