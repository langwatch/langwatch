/**
 * Token estimation and byte-accurate cutting for text handed to a model.
 *
 * The estimate is UTF-8 bytes divided by four, the same rule the scenario
 * judge uses (`estimateTokens`). It is deliberately not a real tokenizer:
 * loading one costs more than the budget it protects, and the failure it
 * guards against (a payload the model refuses outright) needs an estimate
 * that is never wildly low, which byte length gives us for CJK and emoji
 * where a character count would not.
 */

/** Estimated tokens in a string, from its UTF-8 byte length. */
export function estimateTokensFromBytes(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 4);
}

/**
 * Cut a string down to an estimated token count, on a character boundary.
 *
 * The budget is a byte count, and a byte cut can land inside a multi-byte
 * character, so the cut moves back to the last complete character rather than
 * shipping a half-decoded one. Text that legitimately ends in a replacement
 * character keeps it: only incomplete byte sequences are dropped.
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
  return new TextDecoder().decode(
    bytes.subarray(0, characterBoundaryAtOrBefore({ bytes, limit })),
  );
}

/**
 * The largest index at or before `limit` that ends a whole UTF-8 character.
 *
 * A continuation byte (`10xxxxxx`) at the cut means the character it belongs
 * to started earlier, so the cut moves back to that character's lead byte and
 * drops it whole.
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
 * Cut a line-oriented text to a token budget without splitting a line.
 *
 * A digest whose lines each mean something (a span in a tree, a row in a
 * table) reads as corrupt when the cut lands mid-line, so the cut moves back
 * to the last line break. A first line already over the budget has no break
 * to move back to and is cut where the budget ends.
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
