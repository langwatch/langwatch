import { createLogger } from "~/utils/logger";
import { EventUtils } from "../../library";
import type { AggregateType } from "../../library/domain/aggregateType";
import type { TenantId } from "../../library/domain/tenantId";
import type { Event, ProcessorCheckpoint } from "../../library/domain/types";
import { ConfigurationError } from "../../library/services/errorHandling";
import type { ProcessorCheckpointStore } from "../../library/stores/eventHandlerCheckpointStore.types";
import {
  buildCheckpointKey,
  parseCheckpointKey,
} from "../../library/utils/checkpointKey";
import type {
  CheckpointRecord,
  CheckpointRepository,
} from "./repositories/checkpointRepository.types";
import { CheckpointRepositoryMemory } from "./repositories/checkpointRepositoryMemory";

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
  private readonly repository: CheckpointRepository;
  private readonly logger = createLogger(
    "langwatch:event-sourcing:processor-checkpoint-store:memory",
  );

  constructor(repository?: CheckpointRepository) {
    // Prevent accidental use in production - memory stores are not thread-safe
    if (process.env.NODE_ENV === "production") {
      throw new ConfigurationError(
        "ProcessorCheckpointStoreMemory",
        "ProcessorCheckpointStoreMemory is not thread-safe and cannot be used in production. Use ProcessorCheckpointStoreClickHouse or another thread-safe implementation instead.",
      );
    }
    this.repository = repository ?? new CheckpointRepositoryMemory();
  }

  async saveCheckpoint<EventType extends Event>(
    tenantId: TenantId,
    checkpointKey: string,
    processorType: "handler" | "projection",
    event: EventType,
    status: "processed" | "failed" | "pending",
    sequenceNumber: number,
    errorMessage?: string,
  ): Promise<void> {
    // Validate tenantId
    EventUtils.validateTenantId(
      { tenantId },
      "ProcessorCheckpointStoreMemory.saveCheckpoint",
    );

    // Parse checkpointKey to extract tenantId for verification
    const parsedKey = parseCheckpointKey(checkpointKey);

    // Verify tenantId matches event.tenantId
    if (tenantId.toString() !== event.tenantId.toString()) {
      throw new Error(
        `TenantId mismatch: provided tenantId (${tenantId.toString()}) does not match event.tenantId (${event.tenantId.toString()})`,
      );
    }

    // Verify tenantId matches the tenantId in checkpointKey
    if (tenantId.toString() !== parsedKey.tenantId.toString()) {
      throw new Error(
        `TenantId mismatch: provided tenantId (${tenantId.toString()}) does not match checkpointKey tenantId (${parsedKey.tenantId.toString()})`,
      );
    }

    const now = Date.now();

    // Extract processorName from checkpointKey (format: tenantId:pipelineName:processorName:aggregateType:aggregateId)
    const { processorName } = parsedKey;

    // Transform to record
    const record: CheckpointRecord = {
      CheckpointKey: checkpointKey,
      ProcessorName: processorName,
      ProcessorType: processorType,
      EventId: event.id,
      Status: status,
      EventTimestamp: event.timestamp,
      SequenceNumber: sequenceNumber,
      ProcessedAt: status === "processed" ? now : null,
      FailedAt: status === "failed" ? now : null,
      ErrorMessage: status === "failed" ? (errorMessage ?? null) : null,
      TenantId: event.tenantId,
      AggregateType: event.aggregateType,
      AggregateId: String(event.aggregateId),
    };

    // Delegate to repository
    await this.repository.insertCheckpointRecord(record);
  }

  async loadCheckpoint(
    checkpointKey: string,
  ): Promise<ProcessorCheckpoint | null> {
    // Get record from repository
    const record = await this.repository.getCheckpointRecord(checkpointKey);

    if (!record) {
      return null;
    }

    // Transform to checkpoint
    return this.recordToCheckpoint(record);
  }

  async getLastProcessedEvent(
    pipelineName: string,
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

    // Build checkpoint key (business logic in store layer)
    const checkpointKey = buildCheckpointKey(
      tenantId,
      pipelineName,
      processorName,
      aggregateType,
      aggregateId,
    );

    // Get record from repository
    const record =
      await this.repository.getLastProcessedCheckpointRecord(checkpointKey);

    if (!record) {
      return null;
    }

    // Transform to checkpoint
    return this.recordToCheckpoint(record);
  }

  async getCheckpointBySequenceNumber(
    pipelineName: string,
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

    // Build aggregate checkpoint key (business logic in store layer)
    const checkpointKey = buildCheckpointKey(
      tenantId,
      pipelineName,
      processorName,
      aggregateType,
      aggregateId,
    );

    this.logger.debug(
      {
        pipelineName,
        processorName,
        processorType,
        tenantId,
        aggregateType,
        aggregateId,
        sequenceNumber,
        checkpointKey,
      },
      "getCheckpointBySequenceNumber",
    );

    // Get record from repository
    const record = await this.repository.getCheckpointRecordBySequenceNumber(
      checkpointKey,
      sequenceNumber,
    );

    if (!record) {
      return null;
    }

    // Transform to checkpoint
    return this.recordToCheckpoint(record);
  }

  async hasFailedEvents(
    pipelineName: string,
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

    // Build checkpoint key (business logic in store layer)
    const checkpointKey = buildCheckpointKey(
      tenantId,
      pipelineName,
      processorName,
      aggregateType,
      aggregateId,
    );

    // Delegate to repository
    return await this.repository.hasFailedCheckpointRecords(checkpointKey);
  }

  async getFailedEvents(
    pipelineName: string,
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

    // Build checkpoint key (business logic in store layer)
    const checkpointKey = buildCheckpointKey(
      tenantId,
      pipelineName,
      processorName,
      aggregateType,
      aggregateId,
    );

    // Get records from repository
    const records =
      await this.repository.getFailedCheckpointRecords(checkpointKey);

    // Transform to checkpoints
    return records.map((record) => this.recordToCheckpoint(record));
  }

  async clearCheckpoint(
    tenantId: TenantId,
    checkpointKey: string,
  ): Promise<void> {
    // Validate tenantId
    EventUtils.validateTenantId(
      { tenantId },
      "ProcessorCheckpointStoreMemory.clearCheckpoint",
    );

    // Parse checkpointKey to extract tenantId for verification
    const parsedKey = parseCheckpointKey(checkpointKey);

    // Verify tenantId matches the tenantId in checkpointKey
    if (tenantId.toString() !== parsedKey.tenantId.toString()) {
      throw new Error(
        `TenantId mismatch: provided tenantId (${tenantId.toString()}) does not match checkpointKey tenantId (${parsedKey.tenantId.toString()})`,
      );
    }

    // Delegate to repository
    await this.repository.deleteCheckpointRecord(checkpointKey);
  }

  /**
   * Transforms a CheckpointRecord to a ProcessorCheckpoint.
   */
  private recordToCheckpoint(record: CheckpointRecord): ProcessorCheckpoint {
    return {
      processorName: record.ProcessorName,
      processorType: record.ProcessorType,
      eventId: record.EventId,
      status: record.Status,
      eventTimestamp: record.EventTimestamp,
      sequenceNumber: record.SequenceNumber,
      processedAt: record.ProcessedAt ?? void 0,
      failedAt: record.FailedAt ?? void 0,
      errorMessage: record.ErrorMessage ?? void 0,
      tenantId: record.TenantId as TenantId,
      aggregateType: record.AggregateType as AggregateType,
      aggregateId: record.AggregateId,
    };
  }
}
