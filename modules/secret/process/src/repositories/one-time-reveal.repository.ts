import type { OneTimeRevealKind } from "@langwatch/secret-contract";

/** A parked reveal, as the store holds it: never the plaintext. */
export type StoredReveal = {
  kind: OneTimeRevealKind;
  keyId: string;
  preview: string;
  /** The secret, sealed with the process's own cipher. */
  sealed: string;
};

/** What a read-and-delete found, if anything. */
export type TakenReveal = { taken: true; reveal: StoredReveal } | { taken: false };

/**
 * Short-lived storage for one-time reveals, keyed by organization and reveal
 * id. `take` is read-and-delete and must be ATOMIC: two reads racing on one
 * id may not both be served, which is the property the feature rests on.
 */
export interface OneTimeRevealRepository {
  /** Parks a reveal for `ttlMs`. */
  put(input: {
    organizationId: string;
    revealId: string;
    reveal: StoredReveal;
    ttlMs: number;
  }): Promise<void>;
  /** Serves the reveal and deletes it. A reveal that was never there, or has
   *  expired, is `{ taken: false }` - a write whose target may be absent. */
  take(input: { organizationId: string; revealId: string }): Promise<TakenReveal>;
  /** Records that this id was served, so a second read is told apart from an
   *  id that expired or never existed. */
  markServed(input: { organizationId: string; revealId: string; ttlMs: number }): Promise<void>;
  /** Whether this id was already served. */
  wasServed(input: { organizationId: string; revealId: string }): Promise<boolean>;
}
