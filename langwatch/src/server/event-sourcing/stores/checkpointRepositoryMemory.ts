import type { CheckpointRepository, BulkRebuildCheckpoint } from "../library";
import { EventUtils } from "../library";

/**
 * In-memory implementation of checkpoint repository for testing.
 */
export class CheckpointRepositoryMemory
  implements CheckpointRepository<string>
{
  private checkpoints = new Map<string, BulkRebuildCheckpoint<string>>();

  async saveCheckpoint(
    tenantId: string,
    aggregateType: string,
    checkpoint: BulkRebuildCheckpoint<string>,
  ): Promise<void> {
    // Validate tenant context
    EventUtils.validateTenantId(
      { tenantId },
      "CheckpointRepositoryMemory.saveCheckpoint",
    );

    const key = `${tenantId}:${aggregateType}`;
    // Deep clone to prevent mutation
    this.checkpoints.set(key, {
      cursor: checkpoint.cursor,
      lastAggregateId: checkpoint.lastAggregateId,
      processedCount: checkpoint.processedCount,
    });
  }

  async loadCheckpoint(
    tenantId: string,
    aggregateType: string,
  ): Promise<BulkRebuildCheckpoint<string> | null> {
    // Validate tenant context
    EventUtils.validateTenantId(
      { tenantId },
      "CheckpointRepositoryMemory.loadCheckpoint",
    );

    const key = `${tenantId}:${aggregateType}`;
    const checkpoint = this.checkpoints.get(key);
    if (!checkpoint) {
      return null;
    }
    // Deep clone to prevent mutation
    return {
      cursor: checkpoint.cursor,
      lastAggregateId: checkpoint.lastAggregateId,
      processedCount: checkpoint.processedCount,
    };
  }

  async clearCheckpoint(
    tenantId: string,
    aggregateType: string,
  ): Promise<void> {
    // Validate tenant context
    EventUtils.validateTenantId(
      { tenantId },
      "CheckpointRepositoryMemory.clearCheckpoint",
    );

    const key = `${tenantId}:${aggregateType}`;
    this.checkpoints.delete(key);
  }
}
