import { createHash, createPublicKey } from "node:crypto";

const ESCAPED_NEWLINES = /\\r\\n|\\n/g;

/** Tells verifying keys apart without carrying them; wrapping and escaping don't change it. */
export function licenseKeyFingerprint(publicKey: string): string {
  return createHash("sha256").update(derOf(publicKey)).digest("hex").slice(0, 16);
}

/** The key as DER, as in ops' cloud-ops rules; a key that does not parse is hashed as written. */
function derOf(publicKey: string): Buffer | string {
  try {
    return createPublicKey(publicKey.replace(ESCAPED_NEWLINES, "\n")).export({
      type: "spki",
      format: "der",
    });
  } catch {
    return publicKey.trim();
  }
}
