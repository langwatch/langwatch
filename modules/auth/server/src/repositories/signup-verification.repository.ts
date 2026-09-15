import type { Instant } from "@langwatch/time";

/**
 * Sign-up's single-use address-confirmation tokens, as storage holds them.
 *
 * Issuing and spending are the only two operations: a token is never listed,
 * counted or read back by anything but itself, and the row is destroyed on the
 * way past so a spent link cannot be replayed.
 */
export interface SignUpVerificationTokenRepository {
  issue(input: { identifier: string; token: string; expires: Instant }): Promise<void>;
  /**
   * Spends a token: returns the identifier it was issued for and makes it
   * unusable, or answers null for a token that never existed, was already
   * spent, or has expired. One answer for all three on purpose - the way on is
   * the same, and telling them apart would say whether a guessed link was real.
   */
  findAndClaim(input: { token: string; now: Instant }): Promise<{ identifier: string } | null>;
}
