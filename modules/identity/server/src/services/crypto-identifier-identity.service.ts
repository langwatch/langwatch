import { createHash } from "node:crypto";
import { Instance, Ksuid } from "@langwatch/ksuid";
import {
  type DeriveIdentifierIdInput,
  IdentifierIdentity,
} from "../app/identity.members.ts";

/**
 * Pinned, never read from the ambient environment - the grants ledger's
 * `deriveGrantId` rationale verbatim (ADR-092 S13): the environment lands in
 */
const IDENTIFIER_ID_ENVIRONMENT = "prod";

/**
 * Deterministic identifier identity (ADR-101 S3): a real KSUID -
 */
export class CryptoIdentifierIdentityAdapter implements IdentifierIdentity {
  static create(): CryptoIdentifierIdentityAdapter {
    return new CryptoIdentifierIdentityAdapter();
  }

  private constructor() {
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
