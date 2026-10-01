import { createHash, createHmac } from "node:crypto";

/**
 * The pinned user id a flagged sign-up is borne under (ADR-116 §3).
 */
export function deriveNewbornUserId({ normalizedValue }: { normalizedValue: string }): string {
  const digest = createHash("sha256").update(`newborn${normalizedValue}`).digest();
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  for (let index = 0; index < 21; index += 1) {
    id += alphabet[(digest[index] as number) % alphabet.length];
  }
  return id;
}

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
