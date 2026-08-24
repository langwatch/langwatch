/**
 * The `User` row as identity touches it: one read and one write.
 *
 * The write is `userHashKey` (ADR-101 §4) — the one identity value that is
 * row-truth on `User` rather than a fact — minted at user creation by the
 * ceremony and swept onto older users by the backfill. Guarded: a key minted
 * concurrently is never overwritten, because rewriting it would orphan every
 * identifier hash already computed with the old key.
 *
 * The read is the email an attach ceremony records as the identifier's
 * value. It lives here rather than on the heads repository because it is a
 * legacy `User` column, not something the projection knows.
 */
export interface IdentityUsersRepository {
  storeUserHashKeyIfMissing(args: {
    userId: string;
    userHashKey: string;
  }): Promise<void>;
  /** The user's current email, or null — including for a user that is gone. */
  findEmail(args: { userId: string }): Promise<string | null>;
}
