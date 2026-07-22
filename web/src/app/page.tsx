import { redirect } from "next/navigation";

/**
 * The executive summary is archived, not deleted. It still renders at /summary, with
 * the derived action list intact; it is simply no longer in the nav. Its two pieces
 * that were still earning their place — the per-language table and review coverage —
 * moved to the metrics page, which is now the landing surface.
 */
export default function HomePage() {
  redirect("/metrics");
}
