// Bounds UTF-8 byte-size of oversized payload strings at content-lift sites.
/**
 * Generous threshold (256KB); real-world text is far smaller. Trips only on
 * embedded binary blobs (base64 images/audio) or pathological payloads.
 */
export const DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES = 256 * 1024;

/** UTF-8 byte length without allocating a Buffer copy. */
function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

// Caps string to maxBytes; keeps head + marker naming original size so result
// never exceeds maxBytes
function capStringWithFlag(
  value: string,
  maxBytes: number,
  label?: string,
): { value: string; capped: boolean } {
  const byteSize = utf8ByteLength(value);
  if (byteSize <= maxBytes) return { value, capped: false };
  const labelPart = label ? ` ${label}` : "";
  const marker = `…[langwatch: truncated${labelPart}, ${byteSize} bytes total]`;
  const budget = Math.max(0, maxBytes - utf8ByteLength(marker));
  // subarray on a UTF-8 buffer can split a multibyte sequence; toString
  // tolerates it (yields a single replacement char), which is fine for a
  // truncation tail and keeps us strictly under budget.
  const head = Buffer.from(value, "utf8").subarray(0, budget).toString("utf8");
  return { value: head + marker, capped: true };
}

/**
 * Public single-string cap. Use at any content lift site to bound a
 * pathological payload before it reaches the fold/ComputedOutput. `label`
 * is embedded in the truncation marker so a cut is visible in the stored value.
 */
export function capPayloadString(
  value: string,
  maxBytes: number = DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  label?: string,
): string {
  return capStringWithFlag(value, maxBytes, label).value;
}
