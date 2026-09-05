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
 */
export abstract class IdentifierIdentityPort {
  /** The deterministic id this fact always derives, on any pass. */
  abstract deriveIdentifierId(fact: DeriveIdentifierIdInput): string;
}
