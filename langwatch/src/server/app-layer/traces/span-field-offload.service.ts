/** Default per-field offload threshold. Matches ADR-017's gateway cap (32 KB). */
export const DEFAULT_OFFLOAD_THRESHOLD_BYTES = 32 * 1024;
/** Bounded preview kept inline in place of an offloaded value. */
export const DEFAULT_PREVIEW_BYTES = 2 * 1024;

/**
 * Extended preview for IO attributes — 32 KB (= threshold) so full-text
 * search on `trace_summaries.ComputedInput/Output` is lossless for
 * sub-threshold values and covers the first 32 KB of offloaded ones.
 * The fold cache (Redis) uses a separate leanness knob (`toCacheable`) and
 * is unaffected by raising this write-into-CH budget. ADR-021.
 */
export const IO_PREVIEW_BYTES = DEFAULT_OFFLOAD_THRESHOLD_BYTES;

/**
 * Span attribute keys that carry primary IO content and therefore use the
 * extended 32 KB preview budget. Non-IO attributes (context, custom metadata,
 * etc.) keep the 2 KB default. ADR-021.
 */
export const IO_ATTR_KEYS = new Set<string>([
  "langwatch.input",
  "langwatch.output",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
]);

/** UTF-8-safe truncation to at most `maxBytes`, backing off to a char boundary. */
export function utf8Preview(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, "utf-8");
  if (buf.byteLength <= maxBytes) return value;
  let end = maxBytes;
  // 0b10xxxxxx are UTF-8 continuation bytes — don't cut mid-codepoint.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8") + "…";
}
