import { createHash } from "node:crypto";
import { Instance, Ksuid } from "@langwatch/ksuid";
import {
  type DeriveIdentifierIdInput,
  IdentifierIdentityPort,
} from "../ports/identifier-identity.port";

/**
 * Pinned, never read from the ambient environment - the grants ledger's
 * `deriveGrantId` rationale verbatim (ADR-092 S13): the environment lands in
 * the returned STRING, so deriving it from configuration would make the id a
 * function of the deriving process rather than of the fact, and the backfill
 * and the live path would stop converging on one row. `"prod"` is the
 * library's own default, i.e. no prefix at all.
 */
const IDENTIFIER_ID_ENVIRONMENT = "prod";

/**
 * Deterministic identifier identity (ADR-101 S3): a real KSUID -
 * `idf_`-prefixed, k-sortable by business time - with every bit derived,
 * none random. The timestamp is the fact's `occurredAt`; the instance and
 * sequence bytes hash the fact's content. The same fact always derives the
 * same id, which is what makes the D01 backfill, live emission, and every
 * projection upsert idempotent without transactions.
 *
 * What is (and isn't) identity:
 * - The provider's own account id when the ceremony carries one (OAuth
 *   `providerAccountId`), otherwise the normalized value - mirroring the
 *   `Account` table's own `(provider, providerAccountId)` uniqueness.
 * - Business time IS part of it: re-attaching the same value after a detach
 *   is a new fact with a new id; the tombstone stays resolvable forever.
 * - Lifecycle state is NOT part of it: verify, primary, detach transition
 *   the same id.
 */
export class CryptoIdentifierIdentityAdapter extends IdentifierIdentityPort {
  static create(): CryptoIdentifierIdentityAdapter {
    return new CryptoIdentifierIdentityAdapter();
  }

  private constructor() {
    super();
  }

  deriveIdentifierId(fact: DeriveIdentifierIdInput): string {
    const { userId, provider, providerAccountId, normalizedValue, occurredAtMs } = fact;
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
}
