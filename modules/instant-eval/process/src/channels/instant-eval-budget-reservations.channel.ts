/**
 * Holds against the free Instant Evals budget: what a run or a judged query
 * expects to spend, kept from acceptance until its spend reaches the ledger.
 * @see specs/instant-evals/instant-eval-billing.feature
 */

/** What a reservation attempt answered. */
export interface InstantEvalBudgetReservationOutcome {
  /** Whether the amount fit under the limit beside the other reservations. */
  readonly isReserved: boolean;
  /** What the other reservations of the organization held, in nano-USD. */
  readonly heldNanoUsd: number;
}

export interface InstantEvalBudgetReservationsChannel {
  /**
   * Holds `nanoUsd` under `reservationId` when it fits: the other live
   * reservations of the organization plus this amount stay within the limit.
   * A reservation under an id already held is replaced, not added.
   */
  reserve(input: {
    organizationId: string;
    reservationId: string;
    nanoUsd: number;
    limitNanoUsd: number;
    ttlMs: number;
  }): Promise<InstantEvalBudgetReservationOutcome>;
  /** Drops the reservation. Releasing one that is not held is not an error. */
  release(input: { organizationId: string; reservationId: string }): Promise<void>;
  /** What the organization's live reservations hold, in nano-USD. */
  heldNanoUsd(input: {
    organizationId: string;
    /** A reservation to leave out, which is how a run excludes its own. */
    except?: string;
  }): Promise<number>;
}
