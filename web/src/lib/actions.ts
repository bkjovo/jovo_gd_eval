import { type Clip, mean, pooledTtfa } from "./clips";
import {
  LANGUAGE_NAMES,
  HUMAN_REJECT_BELOW,
  LUFS_SPREAD_WARN_LU,
  TAGS_BY_ID,
  THRESHOLDS,
  verdictFor,
} from "./taxonomy";
import type { ClipAggregate } from "./ratings";

/**
 * Action items are DERIVED, never authored.
 *
 * Every entry below is produced by comparing measured values against the thresholds
 * in taxonomy.ts. If the corpus changes, the action list changes with it, which is
 * the difference between an evaluation tool and a slide.
 *
 * Objective metrics are never modified by rater input. Human disagreement appears as
 * its own item, labelled as such, alongside the untouched score.
 */

export type ActionItem = {
  severity: "fail" | "warn" | "info";
  title: string;
  detail: string;
  evidence: string;
  source: "objective" | "human-vs-machine";
};

const SEVERITY_RANK = { fail: 0, warn: 1, info: 2 } as const;

function langName(code: string) {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

export function deriveActionItems(
  clips: Clip[],
  aggregates: Record<string, ClipAggregate>,
  minRatings = 3,
): ActionItem[] {
  const items: ActionItem[] = [];
  if (clips.length === 0) return items;

  // --- Intelligibility: clips breaching the WER fail threshold ---
  const werFails = clips.filter(
    (c) => verdictFor("wer_pct", c.metrics.int.wer_pct) === "fail",
  );
  if (werFails.length > 0) {
    const byLang = new Map<string, Clip[]>();
    for (const c of werFails) {
      byLang.set(c.lang, [...(byLang.get(c.lang) ?? []), c]);
    }
    for (const [lang, group] of byLang) {
      const cats = [...new Set(group.map((c) => c.stress_category))];
      items.push({
        severity: "fail",
        title: `${langName(lang)}: word error rate above ${THRESHOLDS.wer_pct.fail}%`,
        detail:
          `${group.length} clip${group.length > 1 ? "s" : ""} ${group.length > 1 ? "exceed" : "exceeds"} the failure threshold. ` +
          `Affected stress categor${cats.length > 1 ? "ies" : "y"}: ${cats.join(", ")}. ` +
          `Compare the ASR hypothesis against the source text to localise the failure.`,
        evidence: group
          .map((c) => `${c.id}: WER ${c.metrics.int.wer_pct}% (${c.metrics.int.sub} sub, ${c.metrics.int.ins} ins, ${c.metrics.int.del} del)`)
          .join(" · "),
        source: "objective",
      });
    }
  }

  // --- Truncation: audio ending before the text does ---
  const truncated = clips.filter((c) => c.metrics.int.truncated);
  if (truncated.length > 0) {
    items.push({
      severity: "fail",
      title: "Truncated output detected",
      detail:
        "Audio ends before the source text is complete. This is a hard failure for any " +
        "production use: the caller hears a sentence cut off mid-word.",
      evidence: truncated
        .map((c) => `${c.id}: duration/expected ${c.metrics.int.dur_expected_ratio}`)
        .join(" · "),
      source: "objective",
    });
  }

  // --- Naturalness: UTMOS below threshold, reported per language ---
  const utmosConcerns = clips.filter(
    (c) => verdictFor("utmos", c.metrics.nat.utmos) !== "pass",
  );
  if (utmosConcerns.length > 0) {
    items.push({
      severity: utmosConcerns.some((c) => verdictFor("utmos", c.metrics.nat.utmos) === "fail")
        ? "fail"
        : "warn",
      title: "Predicted naturalness below target",
      detail:
        `UTMOS under ${THRESHOLDS.utmos.warn} on ${utmosConcerns.length} clip${utmosConcerns.length > 1 ? "s" : ""}. ` +
        "UTMOS is English-trained, so treat non-English values as a within-language signal only. " +
        "Do not compare a Spanish score against an English one.",
      evidence: utmosConcerns
        .map((c) => `${c.id} (${langName(c.lang)}): UTMOS ${c.metrics.nat.utmos}`)
        .join(" · "),
      source: "objective",
    });
  }

  // --- Monotone: low pitch variance is the objective correlate of "robotic" ---
  const flat = clips.filter((c) => c.metrics.nat.f0_semitone_std < 2.5);
  if (flat.length > 0) {
    items.push({
      severity: "warn",
      title: "Low pitch variation: monotone risk",
      detail:
        "F0 standard deviation under 2.5 semitones. This is the measurable correlate of the " +
        "\"robotic tone\" defect raters report; cross-check against the rater tag counts below.",
      evidence: flat
        .map((c) => `${c.id}: ${c.metrics.nat.f0_semitone_std} st`)
        .join(" · "),
      source: "objective",
    });
  }

  // --- Audio quality: DNSMOS ---
  const dnsConcerns = clips.filter(
    (c) => verdictFor("dnsmos_ovrl", c.metrics.aud.dnsmos_ovrl) !== "pass",
  );
  if (dnsConcerns.length > 0) {
    items.push({
      severity: "warn",
      title: "DNSMOS overall quality below target",
      detail:
        `Signal-level quality under ${THRESHOLDS.dnsmos_ovrl.warn} on ${dnsConcerns.length} clip${dnsConcerns.length > 1 ? "s" : ""}. ` +
        "DNSMOS is independent of whether the words were correct; it points at the audio path, not the model's text handling.",
      evidence: dnsConcerns
        .map((c) => `${c.id}: OVRL ${c.metrics.aud.dnsmos_ovrl} (SIG ${c.metrics.aud.dnsmos_sig} / BAK ${c.metrics.aud.dnsmos_bak})`)
        .join(" · "),
      source: "objective",
    });
  }

  // --- Loudness consistency across the corpus ---
  const lufs = clips.map((c) => c.metrics.aud.lufs);
  const spread = Math.max(...lufs) - Math.min(...lufs);
  if (spread > LUFS_SPREAD_WARN_LU) {
    const quietest = clips.reduce((a, b) => (a.metrics.aud.lufs < b.metrics.aud.lufs ? a : b));
    const loudest = clips.reduce((a, b) => (a.metrics.aud.lufs > b.metrics.aud.lufs ? a : b));
    items.push({
      severity: "warn",
      title: `Output loudness varies ${spread.toFixed(1)} LU across the corpus`,
      detail:
        "Integrated loudness is inconsistent between clips. Anything concatenating these " +
        "outputs, such as an IVR flow or an agent turn sequence, will produce audible volume jumps. " +
        "A normalisation stage downstream of synthesis would remove this entirely.",
      evidence: `quietest ${quietest.id} at ${quietest.metrics.aud.lufs} LUFS · loudest ${loudest.id} at ${loudest.metrics.aud.lufs} LUFS`,
      source: "objective",
    });
  }

  // --- Latency ---
  const latConcerns = clips.filter(
    (c) => verdictFor("ttfa_p90_ms", c.metrics.lat.ttfa_p90_ms) !== "pass",
  );
  if (latConcerns.length > 0) {
    items.push({
      severity: "warn",
      title: "Time-to-first-audio above target",
      detail: `p90 TTFA over ${THRESHOLDS.ttfa_p90_ms.warn} ms. Conversational agents need first audio inside roughly 300 ms to avoid a perceptible gap.`,
      evidence: latConcerns
        .map((c) => `${c.id}: ${c.metrics.lat.ttfa_p90_ms} ms p90`)
        .join(" · "),
      source: "objective",
    });
  } else {
    const pooled = pooledTtfa(clips, 90);
    items.push({
      severity: "info",
      title: "Latency is comfortably within conversational budget",
      detail:
        `Corpus p90 TTFA is ${pooled.value.toFixed(0)} ms, well under the ` +
        `${THRESHOLDS.ttfa_p90_ms.warn} ms target. No action needed; worth protecting as a ` +
        `regression guard.`,
      evidence:
        `p90 pooled over ${pooled.nTrials} timed trials · mean RTF ` +
        `${mean(clips.map((c) => c.metrics.lat.rtf_p50)).toFixed(3)}`,
      source: "objective",
    });
  }

  // --- Human vs machine: metric passes, raters disagree ---
  // Objective scores are NOT modified here. The disagreement is reported as its own finding.
  for (const clip of clips) {
    const agg = aggregates[clip.id];
    if (!agg || agg.n < minRatings) continue;
    const machineLooksFine =
      verdictFor("wer_pct", clip.metrics.int.wer_pct) === "pass" &&
      verdictFor("utmos", clip.metrics.nat.utmos) === "pass" &&
      verdictFor("dnsmos_ovrl", clip.metrics.aud.dnsmos_ovrl) === "pass";
    if (machineLooksFine && agg.mean_overall < HUMAN_REJECT_BELOW) {
      const topTags = Object.entries(agg.tag_counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, n]) => `${TAGS_BY_ID[id]?.label ?? id} (${n})`);
      items.push({
        severity: "fail",
        title: `Metric blind spot on ${clip.id}`,
        detail:
          `Every automated detector passes this clip, yet reviewers scored it ` +
          `${agg.mean_overall.toFixed(2)} out of 5. The scores below are unchanged: this is a gap ` +
          `in what the metrics can see, not a scoring error. Highest-signal candidate for a new detector.`,
        evidence:
          `n=${agg.n} · mean overall ${agg.mean_overall.toFixed(2)} · ` +
          `${(agg.reject_rate * 100).toFixed(0)}% scored it below ${HUMAN_REJECT_BELOW}` +
          (topTags.length ? ` · top tags: ${topTags.join(", ")}` : ""),
        source: "human-vs-machine",
      });
    }
  }

  // --- Blind-spot tags: defects humans report that nothing measures ---
  const blindTagCounts = new Map<string, number>();
  for (const agg of Object.values(aggregates)) {
    for (const [tagId, n] of Object.entries(agg.tag_counts)) {
      const tag = TAGS_BY_ID[tagId];
      if (tag && tag.id !== "other" && tag.metricKeys.length === 0) {
        blindTagCounts.set(tagId, (blindTagCounts.get(tagId) ?? 0) + n);
      }
    }
  }
  for (const [tagId, n] of blindTagCounts) {
    if (n < minRatings) continue;
    items.push({
      severity: "warn",
      title: `"${TAGS_BY_ID[tagId].label}" reported ${n}× with no metric to catch it`,
      detail:
        "Raters can hear this defect and the automated stack has no detector for it. " +
        "Either it needs a new metric, or it stays a human-in-the-loop check; it should " +
        "not be assumed covered by the existing suite.",
      evidence: `${n} tag${n > 1 ? "s" : ""} across the corpus`,
      source: "human-vs-machine",
    });
  }

  return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
