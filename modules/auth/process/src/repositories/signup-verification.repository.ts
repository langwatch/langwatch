import type { Instant } from "@langwatch/time";

/**
 * Sign-up's single-use address-confirmation tokens, as storage holds them. A spent link
 * leaves a marker behind for a grace window, so reopening it can be recognised (main's store).
 */
/** What spending a token answered: the identifier it was issued for, or nothing to spend. */
export type TokenClaim =
  | Readonly<{ claimed: true; identifier: string }>
  | Readonly<{ claimed: false }>;

export interface SignUpVerificationTokenRepository {
  issue(input: { identifier: string; token: string; expires: Instant }): Promise<void>;
  /**
   * Spends a token, leaving a marker until `keepSpentUntil`. Never-existed, already-spent
   * and expired all answer unclaimed alike, so a guessed link learns nothing.
   */
  claim(input: { token: string; now: Instant; keepSpentUntil: Instant }): Promise<TokenClaim>;
  /** The identifier a token was spent for while its marker lives; null for anything else. */
  findSpent(input: { token: string; now: Instant }): Promise<{ identifier: string } | null>;
  /** Spends a live token only when it was issued for exactly this identifier. */
  claimExpected(input: { token: string; identifier: string; now: Instant }): Promise<boolean>;
  /** Whether a live token was issued for exactly this identifier; spends nothing. */
  hasExpected(input: { token: string; identifier: string; now: Instant }): Promise<boolean>;
}
