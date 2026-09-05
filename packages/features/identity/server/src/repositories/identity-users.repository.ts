/**
 * The `User` row as identity touches it: two reads and one write.
 *
 * The write is `userHashKey` (ADR-101 §4) — the one identity value that is
 * row-truth on `User` rather than a fact — minted at user creation by the
 * ceremony and swept onto older users by the backfill. Guarded: a key minted
 * concurrently is never overwritten, because rewriting it would orphan every
 * identifier hash already computed with the old key.
 *
 * The reads are both of `User.email`, and both live here rather than on the
 * heads repository for the same reason: `email` is a legacy `User` column,
 * not something the projection knows. One asks what a user's address IS (the
 * value an attach ceremony records); the other asks WHO holds an address, and
 * that one is the collision guard's — see below.
 */
export interface IdentityUsersRepository {
  storeUserHashKeyIfMissing(args: { userId: string; userHashKey: string }): Promise<void>;
  /** The user's current email, or null — including for a user that is gone. */
  findEmail(args: { userId: string }): Promise<string | null>;
  /**
   * Who holds this address on the LEGACY branch — the half of the
   * cross-population uniqueness question the `Identifier` projection cannot
   * answer (ADR-116 §6).
   *
   * `Identifier` carries only latched users; every other user's address is a
   * `User.email` column and nothing else. So a verify or a primary switch
   * that consults the projection alone sees an address as free when a legacy
   * user is sitting on it, and the collision surfaces as a `User.email
   * @unique` write failure inside the fold instead of a named refusal the
   * customer can act on.
   *
   * The value arrives D01-normalized and is compared case-insensitively
   * against the column as stored. That is an exact comparison, not a
   * normalizing one: a legacy `User.email` of `sam.j+news@acme.com`
   * normalizes to the same mailbox as `sam.j@acme.com` and is NOT caught.
   * That blind spot is `User.email @unique`'s own — the legacy branch would
   * have let those two rows coexist as well — so this closes the collision
   * the database would have failed on, and nothing wider.
   */
  findUserIdByEmail(args: { normalizedValue: string }): Promise<string | null>;
}
