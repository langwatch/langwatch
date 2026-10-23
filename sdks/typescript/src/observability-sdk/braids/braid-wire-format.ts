/**
 * The crypto-free half of braid wire format v1 (ADR-185 section 4): names,
 * the entry key rule and the typed error. Safe in a browser bundle.
 * @module braids/braid-wire-format
 */

/** The baggage entry, and the span attribute, the signature travels as. */
export const BRAID_SIGNATURE_KEY = "langwatch.signature";

/** The first line of every signed message, naming the wire format version. */
export const BRAID_SIGNATURE_DOMAIN = "langwatch-braid-signature-v1";

/** An entry key a braid may sign or copy. */
export const BRAID_ENTRY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Why signing was refused. Switch on code, not message; message is for logs.
 */
export type BraidSigningErrorCode =
  | "malformed_signing_key"
  | "empty_entries"
  | "invalid_entry_key"
  | "invalid_entry_value"
  | "no_active_trace";

/** Signing or copying was refused for a reason the caller can fix. */
export class BraidSigningError extends Error {
  readonly code: BraidSigningErrorCode;

  constructor(code: BraidSigningErrorCode, message: string) {
    super(message);
    this.name = "BraidSigningError";
    this.code = code;
  }
}

/** Refuses an entry key outside the pattern, or the signature's own key. */
export function assertBraidEntryKey(key: string): void {
  if (!BRAID_ENTRY_KEY_PATTERN.test(key) || key === BRAID_SIGNATURE_KEY) {
    throw new BraidSigningError(
      "invalid_entry_key",
      `Braid entry key ${JSON.stringify(key)} must match [A-Za-z0-9._-]{1,128} and not be ${BRAID_SIGNATURE_KEY}`,
    );
  }
}
