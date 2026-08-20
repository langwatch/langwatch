import { createHash, createHmac } from "node:crypto";
import { Instance, Ksuid } from "@langwatch/ksuid";
import type { IdentifierProvider } from "../schemas/events";

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
 * Normalization at attach (D01): NFKC unicode fold, lowercase, trim, and —
 * for email-shaped values — plus-tag stripping on the local part. Applied
 * once, in the command handler; only the normalized form ever reaches an
 * event or the projection.
 */
export function normalizeIdentifierValue(raw: string): string {
  const folded = raw.normalize("NFKC").trim().toLowerCase();
  const at = folded.lastIndexOf("@");
  if (at <= 0) return folded;
  const local = folded.slice(0, at);
  const domain = folded.slice(at + 1);
  const plus = local.indexOf("+");
  return `${plus === -1 ? local : local.slice(0, plus)}@${domain}`;
}

/** The org-level routing fact; null for values that are not email-shaped. */
export function identifierDomain(normalizedValue: string): string | null {
  const at = normalizedValue.lastIndexOf("@");
  if (at <= 0 || at === normalizedValue.length - 1) return null;
  return normalizedValue.slice(at + 1);
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

/**
 * R8 arrival semantics: OAuth/SSO ceremonies arrive VERIFIED (the ceremony
 * is the proof), credential/passkey are verified at creation (account
 * control, not mailbox), `email` arrives ATTACHED and verifies via the
 * magic-link ceremony. Legacy-migration providers arrive VERIFIED — D09
 * migrates only established sign-ins.
 */
export function arrivalStateForProvider(
  provider: IdentifierProvider,
): "ATTACHED" | "VERIFIED" {
  return provider === "email" ? "ATTACHED" : "VERIFIED";
}
