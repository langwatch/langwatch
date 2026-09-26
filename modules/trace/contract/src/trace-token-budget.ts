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

/**
 * Cut a text to a token budget keeping its opening and its ending, with a
 * marker naming what was left out: a head-only cut loses the ending a judge
 * needs (judge benchmark, langwatch/tasks#905). `atLineBreak` keeps whole lines.
 */
export function cutToEstimatedTokensKeepingEnds({
  text,
  maxTokens,
  atLineBreak = false,
}: {
  text: string;
  maxTokens: number;
  atLineBreak?: boolean;
}): string {
  const bytes = new TextEncoder().encode(text);
  const limit = Math.max(0, maxTokens) * 4;
  if (bytes.length <= limit) return text;

  const markerBytes = new TextEncoder().encode(elisionMarker(Math.ceil(bytes.length / 4))).length;
  const room = limit - markerBytes;
  if (room < MIN_KEPT_END_BYTES * 2) {
    return atLineBreak
      ? cutToEstimatedTokensAtLineBreak({ text, maxTokens })
      : cutToEstimatedTokens({ text, maxTokens });
  }

  const decoder = new TextDecoder();
  const headEnd = characterBoundaryAtOrBefore({ bytes, limit: Math.floor(room / 2) });
  const tailStart = characterBoundaryAtOrAfter({
    bytes,
    index: bytes.length - Math.ceil(room / 2),
  });
  let head = decoder.decode(bytes.subarray(0, headEnd));
  let tail = decoder.decode(bytes.subarray(tailStart));
  if (atLineBreak) {
    // A break further than half an end away would throw that end away with it.
    const lastBreak = head.lastIndexOf("\n");
    if (lastBreak >= head.length / 2) head = head.slice(0, lastBreak);
    const firstBreak = tail.indexOf("\n");
    if (firstBreak >= 0 && firstBreak < tail.length / 2) tail = tail.slice(firstBreak + 1);
  }
  const omitted = Math.max(
    1,
    Math.ceil(
      (bytes.length -
        new TextEncoder().encode(head).length -
        new TextEncoder().encode(tail).length) /
        4,
    ),
  );
  return `${head}${elisionMarker(omitted)}${tail}`;
}

/** Below this many bytes per end, a kept ending is too short to read. */
const MIN_KEPT_END_BYTES = 64;

function elisionMarker(omittedTokens: number): string {
  return `\n\n[... ${omittedTokens} tokens omitted from the middle to fit the length limit ...]\n\n`;
}

/** The smallest index at or after `index` that starts a whole UTF-8 character. */
function characterBoundaryAtOrAfter({
  bytes,
  index,
}: {
  bytes: Uint8Array;
  index: number;
}): number {
  let start = Math.max(0, index);
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return start;
}
