/** The retention tables this purge clears, named the way its report names them. */
export type ProcessManagerPurgeTarget = "outbox-dispatched" | "inbox-consumed";

/**
 * The cross-tenant retention reads and deletes the process-manager purge makes.
 * Deletes go in `ctid` batches that need no index; the caller drains a target
 * by calling {@link deleteBatch} until it returns zero.
 */
export abstract class ProcessManagerPurgeRepository {
  abstract countEligible(input: {
    target: ProcessManagerPurgeTarget;
    retentionDays: number;
  }): Promise<number>;

  abstract deleteBatch(input: {
    target: ProcessManagerPurgeTarget;
    retentionDays: number;
    batchSize: number;
  }): Promise<number>;

  /**
   * A plain VACUUM marks the pages reusable; VACUUM FULL would reclaim the
   * space under an ACCESS EXCLUSIVE lock the automations pipeline cannot
   * afford. Never fatal — the rows are already gone.
   */
  abstract vacuum(): Promise<void>;
}
