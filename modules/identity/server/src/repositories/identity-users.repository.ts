/**
 * The `User` row as identity touches it: two reads and one write. The write
 * is `userHashKey` (ADR-101 §4), guarded so a key minted concurrently is
 * never overwritten — rewriting it would orphan every identifier hash already
 * computed with the old key. The reads are both `User.email`, and live here
 * rather than on the heads repository because `email` is a legacy `User`
 * column the projection does not know.
 */
export abstract class IdentityUsersRepository {
  abstract storeUserHashKeyIfMissing(args: { userId: string; userHashKey: string }): Promise<void>;
  /** The user's current email, or null — including for a user that is gone. */
  abstract tryFindEmail(args: { userId: string }): Promise<string | null>;
  /**
   * Who holds this address on the LEGACY branch — the half of the
   * cross-population uniqueness question `Identifier` cannot answer (ADR-116
   * §6), since it carries only latched users. Without this, a legacy-held
   * address looks free and the collision surfaces as a raw `User.email
   * @unique` failure instead of a named refusal.
   */
  abstract tryFindUserIdByEmail(args: { normalizedValue: string }): Promise<string | null>;
}
