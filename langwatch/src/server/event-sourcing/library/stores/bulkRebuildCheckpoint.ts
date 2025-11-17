/**
 * Checkpoint for bulk rebuild progress tracking.
 *
 * This is a generic, domain-agnostic abstraction that can be reused by any
 * aggregate type that needs resumable bulk rebuilds.
 */
export interface BulkRebuildCheckpoint<AggregateId = string> {
  cursor?: string | number | null | Record<string, unknown>;
  lastAggregateId?: AggregateId;
  processedCount: number;
}

/**
 * Repository interface for managing bulk rebuild checkpoints.
 *
 * Implementations are responsible for persisting checkpoints for a given
 * tenant and aggregate type so bulk rebuilds can be resumed safely.
 */
export interface CheckpointRepository<AggregateId = string> {
  /**
   * Saves a checkpoint for bulk rebuild progress.
   */
  saveCheckpoint(
    tenantId: string,
    aggregateType: string,
    checkpoint: BulkRebuildCheckpoint<AggregateId>,
  ): Promise<void>;

  /**
   * Loads the latest checkpoint for a tenant and aggregate type.
   */
  loadCheckpoint(
    tenantId: string,
    aggregateType: string,
  ): Promise<BulkRebuildCheckpoint<AggregateId> | null>;

  /**
   * Clears the checkpoint for a tenant and aggregate type.
   */
  clearCheckpoint(tenantId: string, aggregateType: string): Promise<void>;
}
