/**
 * The address lock (ADR-116 §6): claims are taken atomically here, BEFORE the
 * proof is consumed, so two claims on the same address can no longer both pass
 * a read-then-write race before either write lands. It is a LOCK, not a truth
 * table — `Identifier` still records who holds which sign-in method.
 */

import type { Instant } from "@langwatch/time";

/** Who holds a normalized address after a claim attempt. */
export interface IdentifierReservationHolder {
  normalizedValue: string;
  userId: string;
  identifierId: string;
  commandId: string;
}

export abstract class IdentityReservationRepository {
  /**
   * Take the claim, atomically, and answer whoever holds the value once
   * settled — this caller when they won, somebody else when they lost. Never
   * throws on a conflict: a caller who lost needs to say so in their own words.
   */
  abstract claim(args: {
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
  abstract release(args: {
    userId: string;
    holdingIdentifierIds: readonly string[];
  }): Promise<number>;

  /**
   * Claims older than the horizon that no live identifier backs at all: the
   * residue of a ceremony that claimed and then never landed its fact. Bounded
   * per pass, like every other sweep.
   */
  abstract reapOrphans(args: { olderThan: Instant; limit: number }): Promise<number>;
}
