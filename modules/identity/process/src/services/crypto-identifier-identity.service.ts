import { createHash } from "node:crypto";

import type { IdentifierProvider } from "@langwatch/identity-contract";
import { Instance, Ksuid, type KsuidLayout } from "@langwatch/ksuid";

/** The fact an identifier id is derived from. */
type DeriveIdentifierIdInput = {
  userId: string;
  provider: IdentifierProvider;
  providerAccountId: string | null;
  normalizedValue: string;
  occurredAtMs: number;
};

/** The two ids one fact derives: "v2", and the "v1-legacy" bytes rows stored before #9575 carry. */
export type IdentifierIdCandidates = Readonly<{ v2: string; legacy: string }>;

/**
 * Where an identifier fact's identity comes from.
 */
export interface IdentifierIdentity {
  /** Both ids this fact derives, on any pass. Reads nothing. */
  deriveIdentifierIdCandidates(fact: DeriveIdentifierIdInput): IdentifierIdCandidates;
  /** The candidate already stored (legacy first), else v2: a stored id never changes. */
  deriveIdentifierId(
    fact: DeriveIdentifierIdInput & { storedIdentifierIds: ReadonlySet<string> },
  ): string;
}

/**
 * Pinned, never read from the ambient environment - the grants ledger's
 * grant id rationale verbatim (ADR-092 S13): the environment lands in
 */
const IDENTIFIER_ID_ENVIRONMENT = "prod";

/**
 * Deterministic identifier identity (ADR-101 S3): a real KSUID -
 */
export class CryptoIdentifierIdentityService implements IdentifierIdentity {
  static create(): CryptoIdentifierIdentityService {
    return new CryptoIdentifierIdentityService();
  }

  private constructor() {}

  deriveIdentifierIdCandidates(fact: DeriveIdentifierIdInput): IdentifierIdCandidates {
    return {
      v2: this.derive({ fact, layout: "v2" }),
      legacy: this.derive({ fact, layout: "v1-legacy" }),
    };
  }

  deriveIdentifierId({
    storedIdentifierIds,
    ...fact
  }: DeriveIdentifierIdInput & { storedIdentifierIds: ReadonlySet<string> }): string {
    const { v2, legacy } = this.deriveIdentifierIdCandidates(fact);
    if (storedIdentifierIds.has(legacy)) return legacy;
    return v2;
  }

  private derive({ fact, layout }: { fact: DeriveIdentifierIdInput; layout: KsuidLayout }): string {
    const { userId, provider, providerAccountId, normalizedValue, occurredAtMs } = fact;
    const parts = [userId, provider, providerAccountId ?? normalizedValue];
    // ASCII unit separator, not a space: no part may smuggle a boundary
    // character (the same choice the grant id makes, for the same reason).
    const digest = createHash("sha256").update(parts.join("\u001f")).digest();
    const instance = new Instance(
      Instance.schemes.RANDOM,
      new Uint8Array(digest.buffer, digest.byteOffset, 8),
    );
    const sequenceId = digest.readUInt32BE(8);
    const timestampSeconds = Math.floor(occurredAtMs / 1000);
    return new Ksuid({
      environment: IDENTIFIER_ID_ENVIRONMENT,
      resource: "idf",
      timestamp: timestampSeconds,
      instance,
      sequenceId,
      layout,
    }).toString();
  }
}
