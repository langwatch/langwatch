/**
 * Whether a search-bar sentence reads as a question about each trace. A question is never a
 * literal string to look for, so it is judged rather than matched as a phrase.
 * @see specs/traces-v2/search.feature "Enter routes a sentence"
 */

/** The words a yes/no or wh- question opens with, lower-cased. */
const QUESTION_OPENERS: ReadonlySet<string> = new Set([
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "has",
  "have",
  "had",
  "can",
  "could",
  "should",
  "would",
  "will",
  "who",
  "what",
  "which",
  "why",
  "how",
  "when",
  "where",
]);

/** An opener alone ("is", "how") is a word to search for, not a question. */
const MIN_OPENER_QUESTION_WORDS = 3;

export function isSearchQuestion(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (trimmed.endsWith("?")) return /\p{L}/u.test(trimmed);
  const words = trimmed.split(/\s+/).filter(Boolean);
  const opener = words[0]?.toLowerCase();
  return (
    words.length >= MIN_OPENER_QUESTION_WORDS &&
    opener !== undefined &&
    QUESTION_OPENERS.has(opener)
  );
}
