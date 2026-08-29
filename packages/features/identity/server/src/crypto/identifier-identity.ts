import { createHash, createHmac } from "node:crypto";
import type { IdentifierProvider } from "@langwatch/identity-contract";
import { Instance, Ksuid } from "@langwatch/ksuid";

/**
 * Pinned, never read from the ambient environment — the grants ledger's
 * `deriveGrantId` rationale verbatim (ADR-092 §13): the environment lands in
 * the returned STRING, so deriving it from configuration would make the id a
 * function of the deriving process rather than of the fact, and the backfill
 * and the live path would stop converging on one row. `"prod"` is the
 * library's own default, i.e. no prefix at all.
 */
const IDENTIFIER_ID_ENVIRONMENT = "prod";

/**
 * Deterministic identifier identity (ADR-101 §3): a real KSUID —
 * `idf_`-prefixed, k-sortable by business time — with every bit derived,
 * none random. The timestamp is the fact's `occurredAt`; the instance and
 * sequence bytes hash the fact's content. The same fact always derives the
 * same id, which is what makes the D01 backfill, live emission, and every
 * projection upsert idempotent without transactions.
 *
 * What is (and isn't) identity:
 * - The provider's own account id when the ceremony carries one (OAuth
 *   `providerAccountId`), otherwise the normalized value — mirroring the
 *   `Account` table's own `(provider, providerAccountId)` uniqueness.
 * - Business time IS part of it: re-attaching the same value after a detach
 *   is a new fact with a new id; the tombstone stays resolvable forever.
 * - Lifecycle state is NOT part of it: verify, primary, detach transition
 *   the same id.
 */
export function deriveIdentifierId({
  userId,
  provider,
  providerAccountId,
  normalizedValue,
  occurredAtMs,
}: {
  userId: string;
  provider: IdentifierProvider;
  providerAccountId: string | null;
  normalizedValue: string;
  occurredAtMs: number;
}): string {
  const parts = [userId, provider, providerAccountId ?? normalizedValue];
  // ASCII unit separator, not a space: no part may smuggle a boundary
  // character (the same choice deriveGrantId makes, for the same reason).
  const digest = createHash("sha256").update(parts.join("\u001f")).digest();
  const instance = new Instance(
    Instance.schemes.RANDOM,
    new Uint8Array(digest.buffer, digest.byteOffset, 8),
  );
  const sequenceId = digest.readUInt32BE(8);
  const timestampSeconds = Math.floor(occurredAtMs / 1000);
  return new Ksuid(
    IDENTIFIER_ID_ENVIRONMENT,
    "idf",
    timestampSeconds,
    instance,
    sequenceId,
  ).toString();
}

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
export function deriveNewbornUserId({
  normalizedValue,
}: {
  normalizedValue: string;
}): string {
  const digest = createHash("sha256")
    .update(`newborn${normalizedValue}`)
    .digest();
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
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
