/**
 * The row writes the born-finalized entrance performs, and the sweep that The entrance and the
 * reconciliation sweep hold this;
 * cleans up after the ones that never happened (ADR-116 §3).
 */
export abstract class IdentityNewbornRepository {
  /**
   * Stake the newborn's tenant BEFORE the append, so an entrance that fails
   * between the append and the row commit leaves something the sweep can
   * find.
   */
  abstract claim(args: { userId: string }): Promise<void>;
  /** The user already sitting at the derived id, or null when it is free. */
  abstract tryFindUserAtPinnedId(args: { userId: string }): Promise<{ id: string } | null>;
  /** The user row and its `finalized` state row, in one transaction. */
  abstract commitNewborn(args: {
    userId: string;
    user: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  /** Claims whose rows never landed, oldest first, bounded by `limit`. */
  abstract findAbandoned(args: { olderThan: Date; limit: number }): Promise<AbandonedNewborn[]>;
  /** Drop one abandoned claim, once its stream has been erased. */
  abstract releaseClaim(args: { userId: string }): Promise<void>;
}

/** One newborn tenant whose facts landed and whose rows never did. */
export interface AbandonedNewborn {
  userId: string;
  claimedAt: Date;
}
