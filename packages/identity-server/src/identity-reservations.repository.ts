/**
 * The address lock (ADR-116 §6).
 *
 * Uniqueness of a proven identifier value used to be a command-time READ: ask
 * whether anybody else holds the address, then state the fact. Two claims on
 * the same address can both pass that read before either write lands, and the
 * loser's verification then sits in the event log forever with its single-use
 * proof already burned.
 *
 * So a claim is taken here first, atomically, BEFORE the proof is consumed and
 * BEFORE any fact is appended. The loser is refused synchronously with
 * `identity_email_in_use`, and nothing about the losing attempt is recorded.
 *
 * It is a LOCK, not a truth table. `Identifier` remains the record of who
 * holds which sign-in method; this decides who gets to. Which is why it is
 * released rather than folded, and why an abandoned claim is reaped rather
 * than replayed.
 */

/** Who holds a normalized address after a claim attempt. */
export interface IdentifierReservationHolder {
  normalizedValue: string;
  userId: string;
  identifierId: string;
  commandId: string;
}

export interface IdentityReservationRepository {
  /**
   * Take the claim, atomically, and answer whoever holds the value once the
   * attempt has settled — this caller when they won or already held it,
   * somebody else when they lost.
   *
   * Never throws on a conflict: a caller who lost needs to say so in their own
   * words, and the backfill treats a collision as a parity fact rather than a
   * failure.
   */
  claim(args: {
    normalizedValue: string;
    userId: string;
    identifierId: string;
    commandId: string;
  }): Promise<IdentifierReservationHolder>;

  /**
   * Every claim this user holds that none of the identifiers named here backs
   * any more — detached, dead-ended, or erased out of its value. Called by the
   * fold, which is the one place that knows a user's whole identifier state.
   */
  release(args: {
    userId: string;
    holdingIdentifierIds: readonly string[];
  }): Promise<number>;

  /**
   * Claims older than the horizon that no live identifier backs at all: the
   * residue of a ceremony that claimed and then never landed its fact. Bounded
   * per pass, like every other sweep.
   */
  reapOrphans(args: { olderThan: Date; limit: number }): Promise<number>;
}
