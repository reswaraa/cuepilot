import type { MatchResult } from "./fuzzy-matcher";

export type SemanticIndex = {
  /**
   * Sliding 2-sentence windows.
   * window[i] = sentences[i] + " " + sentences[i+1] (or just sentences[i] for the last).
   * The match result's index is the *first* sentence in the window, which is what
   * gets highlighted — same convention as the fuzzy matcher.
   */
  windowEmbeddings: number[][];
};

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function buildSlidingWindows(sentences: string[]): string[] {
  const windows: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const next = sentences[i + 1];
    windows.push(next ? `${sentences[i]} ${next}` : sentences[i]);
  }
  return windows;
}

export async function buildSemanticIndex(
  sentences: string[],
  embedBatch: (texts: string[]) => Promise<number[][]>,
): Promise<SemanticIndex> {
  if (sentences.length === 0) return { windowEmbeddings: [] };
  const windows = buildSlidingWindows(sentences);
  const windowEmbeddings = await embedBatch(windows);
  return { windowEmbeddings };
}

export function semanticMatch(
  index: SemanticIndex,
  transcriptEmbedding: number[],
): MatchResult {
  const { windowEmbeddings } = index;
  if (windowEmbeddings.length === 0) {
    return { index: 0, score: 0, scores: [] };
  }
  const scores = windowEmbeddings.map((w) => cosine(w, transcriptEmbedding));
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestIndex = i;
    }
  }
  return { index: bestIndex, score: Math.max(0, bestScore), scores };
}
