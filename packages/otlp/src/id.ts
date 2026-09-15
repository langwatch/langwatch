/** The hex spelling of a byte string, two lower-case digits per byte. */
export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/**
 * A trace or span identifier, in hex, from whichever encoding it arrived in:
 * bytes, base64 (protobuf-JSON), or already hex — told apart by shape, not a
 * flag. Checks for base64's *distinctive* characters (`+`, `/`, `=`) rather
 * than valid base64, since a 32-char hex id is ALSO valid base64 and
 * decoding it would silently corrupt it; an ambiguous string is left as-is,
 * so the failure mode is a passthrough, never a corrupted id.
 */
export function decodeBase64OpenTelemetryId(value: unknown): string | null {
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (typeof value !== "string") return null;
  if (!/[+/=]/.test(value)) return value;
  try {
    return Buffer.from(value, "base64").toString("hex");
  } catch {
    return value;
  }
}
