import { createHash } from "node:crypto";

/**
 * What a roster row records for a credential key its process accepts (Alex, 2026-10-09): a short
 * hash of the key's bytes under a fixed label, never the key.
 * Spec: specs/self-hosting/credentials-secret-rotation.feature.
 */
export function credentialKeyFingerprint({ hex }: { hex: string }): string {
  const key = hex.trim();
  // A NEXTAUTH_SECRET fallback is not hex; its own bytes keep two such keys apart.
  const bytes = /^(?:[0-9a-f]{2})+$/i.test(key) ? Buffer.from(key, "hex") : Buffer.from(key);
  return createHash("sha256")
    .update("langwatch:credential-key-fingerprint:v1\0")
    .update(bytes)
    .digest("hex")
    .slice(0, 16);
}
