/** Default per-field offload threshold. Matches ADR-017's gateway cap (32 KB). */
export const DEFAULT_OFFLOAD_THRESHOLD_BYTES = 32 * 1024;
/** Bounded preview kept inline in place of an offloaded value. */
export const DEFAULT_PREVIEW_BYTES = 2 * 1024;

/** UTF-8-safe truncation to at most `maxBytes`, backing off to a char boundary. */
export function utf8Preview(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, "utf-8");
  if (buf.byteLength <= maxBytes) return value;
  let end = maxBytes;
  // 0b10xxxxxx are UTF-8 continuation bytes — don't cut mid-codepoint.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8") + "…";
}
