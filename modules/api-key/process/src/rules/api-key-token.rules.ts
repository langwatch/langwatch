import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** `match_legacy` verifies under a derivation no longer written, so the caller re-hashes. */
export type ApiKeySecretVerdict = "match" | "match_legacy" | "no_match";

export function hashApiKeySecret({ secret, pepper }: { secret: string; pepper: string }): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}

/**
 * The current pepper first. A hash under the pepper a rotation retired, or main's
 * bare sha256, still verifies and reads `match_legacy`.
 */
export function verifyApiKeySecret({
  secret,
  hashedSecret,
  pepper,
  previousPepper,
}: {
  secret: string;
  hashedSecret: string;
  pepper: string;
  previousPepper?: string | undefined;
}): ApiKeySecretVerdict {
  const stored = Buffer.from(hashedSecret, "hex");
  const storedIs = (digest: string): boolean => {
    const candidate = Buffer.from(digest, "hex");
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  };

  if (storedIs(hashApiKeySecret({ secret, pepper }))) return "match";
  const legacyDigests = [
    ...(previousPepper ? [hashApiKeySecret({ secret, pepper: previousPepper })] : []),
    createHash("sha256").update(secret).digest("hex"),
  ];
  return legacyDigests.some((digest) => storedIs(digest)) ? "match_legacy" : "no_match";
}
