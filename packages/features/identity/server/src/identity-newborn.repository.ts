/**
 * The row writes the born-finalized entrance performs, and the sweep that
 * cleans up after the ones that never happened (ADR-116 §3).
 *
 * The entrance and the reconciliation sweep hold this; the Prisma class in
 * `repositories/prisma` is what a composition root binds to it.
 */
export interface IdentityNewbornRepository {
  /**
   * Stake the newborn's tenant BEFORE the append, so an entrance that fails
   * between the append and the row commit leaves something the sweep can
   * find.
   */
  claim(args: { userId: string }): Promise<void>;
  /** The user already sitting at the derived id, or null when it is free. */
  tryFindUserAtPinnedId(args: { userId: string }): Promise<{ id: string } | null>;
  /** The user row and its `finalized` state row, in one transaction. */
  commitNewborn(args: {
    userId: string;
    user: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  /** Claims whose rows never landed, oldest first, bounded by `limit`. */
  findAbandoned(args: { olderThan: Date; limit: number }): Promise<AbandonedNewborn[]>;
  /** Drop one abandoned claim, once its stream has been erased. */
  releaseClaim(args: { userId: string }): Promise<void>;
}

/** One newborn tenant whose facts landed and whose rows never did. */
export interface AbandonedNewborn {
  userId: string;
  claimedAt: Date;
}
