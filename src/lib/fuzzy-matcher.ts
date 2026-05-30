export type MatchResult = {
  index: number;
  score: number;
  scores: number[];
};

const WORD_WEIGHT = 0.4;
const BIGRAM_WEIGHT = 0.6;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function bigrams(words: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    out.add(`${words[i]} ${words[i + 1]}`);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function takeTranscriptTail(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(-maxWords).join(" ");
}

export function matchTranscriptToSentences(
  sentences: string[],
  transcriptTail: string,
): MatchResult {
  const tailWords = tokenize(transcriptTail);
  const tailWordSet = new Set(tailWords);
  const tailBigrams = bigrams(tailWords);

  const scores = sentences.map((sentence) => {
    const sentWords = tokenize(sentence);
    const sentWordSet = new Set(sentWords);
    const sentBigrams = bigrams(sentWords);
    const wordScore = jaccard(sentWordSet, tailWordSet);
    const bigramScore = jaccard(sentBigrams, tailBigrams);
    return WORD_WEIGHT * wordScore + BIGRAM_WEIGHT * bigramScore;
  });

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
