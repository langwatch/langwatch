import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type ApiKeySecretVerdict = "match" | "match_legacy" | "no_match";

export function hashApiKeySecret({ secret, pepper }: { secret: string; pepper: string }): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}

export function verifyApiKeySecret({
  secret,
  hashedSecret,
  pepper,
}: {
  secret: string;
  hashedSecret: string;
  pepper: string;
}): ApiKeySecretVerdict {
  const stored = Buffer.from(hashedSecret, "hex");
  const current = Buffer.from(hashApiKeySecret({ secret, pepper }), "hex");
  if (stored.length === current.length && timingSafeEqual(stored, current)) return "match";
  const legacy = Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex");
  return stored.length === legacy.length && timingSafeEqual(stored, legacy)
    ? "match_legacy"
    : "no_match";
}
