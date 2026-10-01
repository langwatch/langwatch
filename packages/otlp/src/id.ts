/** The hex spelling of a byte string, two lower-case digits per byte. */
export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/**
 * Distinguishes base64 (protobuf-JSON) from hex by base64's distinctive
 * characters, not validity — a hex id is also valid base64, so decoding it
 * would corrupt it. An ambiguous string passes through unchanged.
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
