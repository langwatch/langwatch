/** The hex spelling of a byte string, two lower-case digits per byte. */
export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/**
 * A trace or span identifier, in hex, from whichever encoding it arrived in.
 *
 * OTLP identifiers are bytes. The binary protocol delivers them as a
 * `Uint8Array`; protobuf-JSON base64-encodes them; and a sender that already
 * hex-encodes them sends hex. The three are told apart by shape rather than by
 * a flag, which is why this exists at all:
 *
 *   - a `Uint8Array` is unambiguous;
 *   - a string containing `+`, `/` or `=` cannot be hex, so it is base64;
 *   - anything else is returned as it arrived.
 *
 * The last rule is why the check is for base64's *distinctive* characters
 * rather than for valid base64: a 32-character hex identifier is also valid
 * base64, and decoding it would silently produce a different identifier. Only
 * a character hex cannot contain is proof, so an ambiguous string is left
 * alone — the reading that is right for every sender that emits hex, and the
 * one whose failure mode is a passthrough rather than a corrupted id.
 *
 * Returns `null` for a value that is neither bytes nor a string, since there is
 * no identifier there to decode.
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
