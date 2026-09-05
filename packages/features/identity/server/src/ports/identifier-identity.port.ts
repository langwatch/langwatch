import type { IdentifierProvider } from "@langwatch/identity-contract";

/** The fact an identifier id is derived from. */
export type DeriveIdentifierIdInput = {
  userId: string;
  provider: IdentifierProvider;
  providerAccountId: string | null;
  normalizedValue: string;
  occurredAtMs: number;
};

/**
 * Where an identifier fact's identity comes from.
 *
 * A seam rather than a call because the derivation reaches for KSUID
 * construction, which the guards and the backfill plan have no business
 * naming: they state what the fact is, and the composed adapter says what it
 * is called.
 */
export abstract class IdentifierIdentityPort {
  /** The deterministic id this fact always derives, on any pass. */
  abstract deriveIdentifierId(fact: DeriveIdentifierIdInput): string;
}
