/**
 * The `User` row as identity touches it: two reads and one write. The write,
 * `userHashKey` (ADR-101 §4), is guarded so a concurrently minted key is
 * never overwritten — that would orphan every hash computed with the old key.
 */
export abstract class IdentityUsersRepository {
  abstract storeUserHashKeyIfMissing: (args: {
    userId: string;
    userHashKey: string;
  }) => Promise<void>;
  /** The user's current email, or null — including for a user that is gone. */
  abstract tryFindEmail(args: { userId: string }): Promise<string | null>;
  /**
   * Who holds this address on the LEGACY branch — half of the
   * cross-population uniqueness `Identifier` cannot answer (ADR-116 §6).
   * Without it, a collision surfaces as a raw `User.email` failure.
   */
  abstract tryFindUserIdByEmail(args: { normalizedValue: string }): Promise<string | null>;
  /**
   * The address this person signs in on, whether it is proved, and how many
   * people hold the same one — the three facts a cutover link is decided on.
   * Null for a user that is gone.
   */
  abstract findAddressStanding(args: { userId: string }): Promise<{
    email: string | null;
    emailVerified: boolean;
    holders: number;
  } | null>;
}
