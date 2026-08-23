/**
 * The one identity write that is row-truth on `User` rather than a fact:
 * `userHashKey` (ADR-101 §4), minted at user creation by the adapter and
 * swept onto older users by the backfill. Guarded: a key minted concurrently
 * is never overwritten, because rewriting it would orphan every identifier
 * hash already computed with the old key.
 */
export interface IdentityUsersRepository {
  storeUserHashKeyIfMissing(args: {
    userId: string;
    userHashKey: string;
  }): Promise<void>;
}
