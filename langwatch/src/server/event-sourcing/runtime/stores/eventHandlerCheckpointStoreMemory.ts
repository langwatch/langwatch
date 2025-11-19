import type { EventHandlerCheckpointStore } from "../../library/stores/eventHandlerCheckpointStore.types";
import type { EventHandlerCheckpoint } from "../../library/domain/types";
import type { TenantId } from "../../library/domain/tenantId";
import type { AggregateType } from "../../library/domain/aggregateType";
import { EventUtils } from "../../library";

/**
 * In-memory implementation of EventHandlerCheckpointStore.
 * Used for tests and local development.
 *
 * **WARNING: NOT THREAD-SAFE**
 * This implementation is NOT safe for concurrent access across multiple processes or threads.
 * It is safe for single-instance, single-threaded Node.js deployments.
 *
 * **Use Cases:**
 * - Unit tests
 * - Local development
 * - Single-instance deployments (single Node.js process)
 *
 * **Production Safety:**
 * This implementation will throw an error if used in production environments
 * to prevent accidental deployment of non-thread-safe code in multi-instance setups.
 */
export class EventHandlerCheckpointStoreMemory
  implements EventHandlerCheckpointStore
{
  // Key: `${handlerName}:${tenantId}:${aggregateType}:${aggregateId}`
  private readonly checkpoints = new Map<string, EventHandlerCheckpoint>();

  constructor() {
    // Note: This implementation is safe for single-instance deployments.
    // The pipeline automatically uses ClickHouse checkpoint store when available.
  }

  async saveCheckpoint(
    handlerName: string,
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
    checkpoint: EventHandlerCheckpoint,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId },
      "EventHandlerCheckpointStoreMemory.saveCheckpoint",
    );

    // Validate checkpoint matches parameters
    if (
      checkpoint.handlerName !== handlerName ||
      checkpoint.tenantId !== tenantId ||
      checkpoint.aggregateType !== aggregateType ||
      checkpoint.lastProcessedAggregateId !== aggregateId
    ) {
      throw new Error(
        `[VALIDATION] Checkpoint parameters do not match: expected handlerName=${handlerName}, tenantId=${tenantId}, aggregateType=${aggregateType}, aggregateId=${aggregateId}`,
      );
    }

    const key = this.getKey(handlerName, tenantId, aggregateType, aggregateId);
    // Deep clone to prevent mutation
    this.checkpoints.set(key, {
      ...checkpoint,
      lastProcessedAggregateId: JSON.parse(
        JSON.stringify(checkpoint.lastProcessedAggregateId),
      ),
    });
  }

  async loadCheckpoint(
    handlerName: string,
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<EventHandlerCheckpoint | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "EventHandlerCheckpointStoreMemory.loadCheckpoint",
    );

    const key = this.getKey(handlerName, tenantId, aggregateType, aggregateId);
    const checkpoint = this.checkpoints.get(key);
    if (!checkpoint) {
      return null;
    }

    // Deep clone to prevent mutation
    return {
      ...checkpoint,
      lastProcessedAggregateId: JSON.parse(
        JSON.stringify(checkpoint.lastProcessedAggregateId),
      ),
    };
  }

  async clearCheckpoint(
    handlerName: string,
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId },
      "EventHandlerCheckpointStoreMemory.clearCheckpoint",
    );

    const key = this.getKey(handlerName, tenantId, aggregateType, aggregateId);
    this.checkpoints.delete(key);
  }

  private getKey(
    handlerName: string,
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): string {
    return `${handlerName}:${tenantId}:${aggregateType}:${aggregateId}`;
  }
}
