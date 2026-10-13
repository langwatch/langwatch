import { createHmac } from "node:crypto";

/**
 * HMAC-SHA256(userHashKey, normalized value), `hmac:`-prefixed hex
 * (ADR-101 §4). The key is a row-truth PG value minted at user creation and
 */
export function computeIdentifierHash({
  userHashKey,
  normalizedValue,
}: {
  userHashKey: string;
  normalizedValue: string;
}): string {
  return `hmac:${createHmac("sha256", userHashKey).update(normalizedValue).digest("hex")}`;
}
