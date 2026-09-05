import { createHash, createHmac } from "node:crypto";

/**
 * The pinned user id a flagged sign-up is borne under (ADR-116 §3).
 *
 * Derived from the normalized address and nothing else, because "reused by
 * every retry" is the whole property. A retry is a fresh POST: better-auth
 * mints a new random id, and with it a new tenant, a new command id and a
 * new identifier — so an entrance that failed before its rows committed
 * would leave one orphaned stream per attempt instead of converging on one
 * user. Pinning the id to the address makes the retry state the SAME command
 * id, which the event store dedupes, and write the SAME rows, which are
 * keyed by ids already pinned.
 *
 * Shaped like the `nanoid()` the schema mints, so nothing downstream can
 * tell a borne id from a minted one. It is derived, not secret: user ids are
 * not credentials — a session is — and predictability is the price of
 * convergence, paid only for the flag-listed population this entrance
 * serves.
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
 * shredded on erasure — after which every remaining hash for that user is
 * unlinkable noise.
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
