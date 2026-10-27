import type { OneTimeRevealKind } from "@langwatch/secret-contract";

/** A parked reveal. The live store seals the secret at rest, so a dump lists no plaintext. */
export type StoredReveal = {
  kind: OneTimeRevealKind;
  keyId: string;
  preview: string;
  secret: string;
};

/** What a read-and-delete found, if anything. */
export type TakenReveal = { taken: true; reveal: StoredReveal } | { taken: false };

/** Where a reveal is parked: its organization, the one person it is for, and its id. */
export type RevealAddress = { organizationId: string; recipientUserId: string; revealId: string };

/**
 * Short-lived storage for one-time reveals, keyed by organization, recipient and
 * reveal id. `take` is read-and-delete and must be ATOMIC: two reads racing on one
 * id may not both be served, which is the property the feature rests on.
 */
export interface OneTimeRevealRepository {
  /** Parks a reveal for `ttlMs`. */
  put(input: RevealAddress & { reveal: StoredReveal; ttlMs: number }): Promise<void>;
  /** Serves the reveal and deletes it. A reveal that was never there, or has
   *  expired, is `{ taken: false }` - a write whose target may be absent. */
  take(input: RevealAddress): Promise<TakenReveal>;
  /** Records that this id was served, so a second read is told apart from an
   *  id that expired or never existed. */
  markServed(input: RevealAddress & { ttlMs: number }): Promise<void>;
  /** Whether this id was already served. */
  wasServed(input: RevealAddress): Promise<boolean>;
}
