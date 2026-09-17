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
 * Cut a string down to an estimated token count, on a UTF-8 byte boundary.
 *
 * A cut that lands mid-character would decode to a replacement character, so
 * the trailing replacement characters are dropped rather than shipped.
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
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.subarray(0, limit),
  );
  return decoded.replace(/�+$/, "");
}
