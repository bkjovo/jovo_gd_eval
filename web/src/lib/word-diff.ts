/**
 * Word-level alignment between the source text and an ASR transcript.
 *
 * Used in two places: the Samples browser renders it as a visual diff, and the review
 * flow uses it to find exactly which source words the recogniser disagreed about, so
 * adjudication can be scoped to those words instead of asking a reviewer to scan a
 * whole transcript.
 */

const norm = (w: string) => w.toLowerCase().replace(/[.,!?;:¿¡"“”'’()]/g, "");

export type WordDiff = {
  src: string[];
  hyp: string[];
  /** True where the source word has no counterpart in the transcript. */
  srcMarks: boolean[];
  /** True where the transcript word has no counterpart in the source. */
  hypMarks: boolean[];
};

export function diffWords(source: string, hypothesis: string): WordDiff {
  const src = source.split(/\s+/).filter(Boolean);
  const hyp = hypothesis.split(/\s+/).filter(Boolean);

  // Standard LCS table; corpus lines are short enough that this is free.
  const n = src.length;
  const m = hyp.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        norm(src[i]) === norm(hyp[j])
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const srcMarks: boolean[] = new Array(n).fill(false);
  const hypMarks: boolean[] = new Array(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(src[i]) === norm(hyp[j])) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      srcMarks[i] = true;
      i++;
    } else {
      hypMarks[j] = true;
      j++;
    }
  }
  while (i < n) srcMarks[i++] = true;
  while (j < m) hypMarks[j++] = true;

  return { src, hyp, srcMarks, hypMarks };
}

/** Indices of source words the recogniser disagreed about. */
export function disputedIndices(source: string, hypothesis: string): number[] {
  const { srcMarks } = diffWords(source, hypothesis);
  return srcMarks.flatMap((m, i) => (m ? [i] : []));
}
