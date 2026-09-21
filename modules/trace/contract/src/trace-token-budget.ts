/**
 * Token estimation and byte-accurate cutting for text handed to a model. The
 * estimate is UTF-8 bytes over four, the same rule the scenario judge uses:
 * never wildly low for CJK or emoji, and cheaper than loading a tokenizer.
 */

/** Estimated tokens in a string, from its UTF-8 byte length. */
export function estimateTokensFromBytes(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 4);
}

/**
 * Cut a string down to an estimated token count, on a character boundary: a
 * byte cut can land inside a multi-byte character, and a half-decoded
 * character is not text anyone can read.
 */
export function cutToEstimatedTokens({
  text,
  maxTokens,
}: {
  text: string;
  maxTokens: number;
}): string {
  const bytes = new TextEncoder().encode(text);
  const limit = Math.max(0, maxTokens) * 4;
  if (bytes.length <= limit) return text;
  return new TextDecoder().decode(bytes.subarray(0, characterBoundaryAtOrBefore({ bytes, limit })));
}

/**
 * The largest index at or before `limit` that ends a whole UTF-8 character. A
 * continuation byte (`10xxxxxx`) at the cut means the character it belongs to
 * started earlier, so the cut moves back and drops it whole.
 */
function characterBoundaryAtOrBefore({
  bytes,
  limit,
}: {
  bytes: Uint8Array;
  limit: number;
}): number {
  let end = limit;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return end;
}

/**
 * Cut a line-oriented text to a token budget without splitting a line. A
 * digest whose lines each name something reads as corrupt when the cut lands
 * mid-line; a first line already over the budget has no break to move back to.
 */
export function cutToEstimatedTokensAtLineBreak({
  text,
  maxTokens,
}: {
  text: string;
  maxTokens: number;
}): string {
  const cut = cutToEstimatedTokens({ text, maxTokens });
  if (cut.length === text.length) return cut;
  const lastBreak = cut.lastIndexOf("\n");
  return lastBreak > 0 ? cut.slice(0, lastBreak) : cut;
}
