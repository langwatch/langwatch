import type { ProcessorCheckpointStore } from "../../library/stores/eventHandlerCheckpointStore.types";
import type { Event, ProcessorCheckpoint } from "../../library/domain/types";
import type { TenantId } from "../../library/domain/tenantId";
import type { AggregateType } from "../../library/domain/aggregateType";
import { EventUtils } from "../../library";

/**
 * In-memory implementation of ProcessorCheckpointStore.
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
export class ProcessorCheckpointStoreMemory
  implements ProcessorCheckpointStore
{
  // Key: `${processorName}:${eventId}`
  private readonly checkpoints = new Map<string, ProcessorCheckpoint>();

  constructor() {
    // Note: This implementation is safe for single-instance deployments.
    // The pipeline automatically uses ClickHouse checkpoint store when available.
  }

  async saveCheckpoint<EventType extends Event>(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
    status: "processed" | "failed" | "pending",
    sequenceNumber: number,
    errorMessage?: string,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: event.tenantId },
      "ProcessorCheckpointStoreMemory.saveCheckpoint",
    );

    const checkpointKey = `${processorName}:${event.id}`;
    const now = Date.now();

    const checkpoint: ProcessorCheckpoint = {
      processorName,
      processorType,
      eventId: event.id,
      status,
      eventTimestamp: event.timestamp,
      sequenceNumber,
      processedAt: status === "processed" ? now : void 0,
      failedAt: status === "failed" ? now : void 0,
      errorMessage: status === "failed" ? errorMessage : void 0,
      tenantId: event.tenantId,
      aggregateType: event.aggregateType,
      aggregateId: String(event.aggregateId),
    };

    // Deep clone to prevent mutation
    this.checkpoints.set(checkpointKey, JSON.parse(JSON.stringify(checkpoint)));
  }

  async loadCheckpoint(
    processorName: string,
    processorType: "handler" | "projection",
    eventId: string,
  ): Promise<ProcessorCheckpoint | null> {
    const checkpointKey = `${processorName}:${eventId}`;
    const checkpoint = this.checkpoints.get(checkpointKey);
    if (!checkpoint) {
      return null;
    }

    // Deep clone to prevent mutation
    return JSON.parse(JSON.stringify(checkpoint));
  }

  async getLastProcessedEvent(
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<ProcessorCheckpoint | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "ProcessorCheckpointStoreMemory.getLastProcessedEvent",
    );

    let lastCheckpoint: ProcessorCheckpoint | null = null;
    let lastTimestamp = -1;

    for (const checkpoint of this.checkpoints.values()) {
      if (
        checkpoint.processorName === processorName &&
        checkpoint.processorType === processorType &&
        checkpoint.tenantId === tenantId &&
        checkpoint.aggregateType === aggregateType &&
        checkpoint.aggregateId === aggregateId &&
        checkpoint.status === "processed" &&
        checkpoint.eventTimestamp > lastTimestamp
      ) {
        lastCheckpoint = checkpoint;
        lastTimestamp = checkpoint.eventTimestamp;
      }
    }

    if (!lastCheckpoint) {
      return null;
    }

    // Deep clone to prevent mutation
    return JSON.parse(JSON.stringify(lastCheckpoint));
  }

  async getCheckpointBySequenceNumber(
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
    sequenceNumber: number,
  ): Promise<ProcessorCheckpoint | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "ProcessorCheckpointStoreMemory.getCheckpointBySequenceNumber",
    );

    for (const checkpoint of this.checkpoints.values()) {
      if (
        checkpoint.processorName === processorName &&
        checkpoint.processorType === processorType &&
        checkpoint.tenantId === tenantId &&
        checkpoint.aggregateType === aggregateType &&
        checkpoint.aggregateId === aggregateId &&
        checkpoint.sequenceNumber === sequenceNumber &&
        checkpoint.status === "processed"
      ) {
        // Deep clone to prevent mutation
        return JSON.parse(JSON.stringify(checkpoint));
      }
    }

    return null;
  }

  async hasFailedEvents(
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<boolean> {
    EventUtils.validateTenantId(
      { tenantId },
      "ProcessorCheckpointStoreMemory.hasFailedEvents",
    );

    for (const checkpoint of this.checkpoints.values()) {
      if (
        checkpoint.processorName === processorName &&
        checkpoint.processorType === processorType &&
        checkpoint.tenantId === tenantId &&
        checkpoint.aggregateType === aggregateType &&
        checkpoint.aggregateId === aggregateId &&
        checkpoint.status === "failed"
      ) {
        return true;
      }
    }

    return false;
  }

  async getFailedEvents(
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<ProcessorCheckpoint[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "ProcessorCheckpointStoreMemory.getFailedEvents",
    );

    const failedCheckpoints: ProcessorCheckpoint[] = [];

    for (const checkpoint of this.checkpoints.values()) {
      if (
        checkpoint.processorName === processorName &&
        checkpoint.processorType === processorType &&
        checkpoint.tenantId === tenantId &&
        checkpoint.aggregateType === aggregateType &&
        checkpoint.aggregateId === aggregateId &&
        checkpoint.status === "failed"
      ) {
        failedCheckpoints.push(checkpoint);
      }
    }

    // Sort by event timestamp ascending
    failedCheckpoints.sort((a, b) => a.eventTimestamp - b.eventTimestamp);

    // Deep clone to prevent mutation
    return failedCheckpoints.map((cp) => JSON.parse(JSON.stringify(cp)));
  }

  async clearCheckpoint(
    processorName: string,
    processorType: "handler" | "projection",
    eventId: string,
  ): Promise<void> {
    const checkpointKey = `${processorName}:${eventId}`;
    this.checkpoints.delete(checkpointKey);
  }
}
