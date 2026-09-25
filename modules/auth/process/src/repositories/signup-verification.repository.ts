import type { Instant } from "@langwatch/time";

/**
 * Sign-up's single-use address-confirmation tokens, as storage holds them.
 * Issuing and spending are the only two operations — never listed or counted
 * — and the row is destroyed on the way past so a spent link can't be replayed.
 */
export interface SignUpVerificationTokenRepository {
  issue(input: { identifier: string; token: string; expires: Instant }): Promise<void>;
  /**
   * Spends a token: returns its identifier and makes it unusable, or null for
   * never-existed/already-spent/expired — one answer for all three on purpose,
   * since telling them apart would say whether a guessed link was real.
   */
  findAndClaim(input: { token: string; now: Instant }): Promise<{ identifier: string } | null>;
  /** Spends a live token only when it was issued for exactly this identifier. */
  claimExpected(input: { token: string; identifier: string; now: Instant }): Promise<boolean>;
}
