import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../utils/logger";
import { EventUtils } from "../../library";
import type { AggregateType } from "../../library/domain/aggregateType";
import type { TenantId } from "../../library/domain/tenantId";
import type { Event, ProcessorCheckpoint } from "../../library/domain/types";
import type { ProcessorCheckpointStore } from "../../library/stores/eventHandlerCheckpointStore.types";
import {
  buildCheckpointKey,
  parseCheckpointKey,
} from "../../library/utils/checkpointKey";
import type {
  CheckpointRecord,
  CheckpointRepository,
} from "./repositories/checkpointRepository.types";

/**
 * ClickHouse implementation of ProcessorCheckpointStore.
 * Provides distributed checkpoint storage for multi-instance deployments.
 *
 * **Table Schema:**
 * ```sql
 * CREATE TABLE IF NOT EXISTS processor_checkpoints (
 *   CheckpointKey String, -- Primary key: tenantId:pipelineName:processorName:aggregateType:aggregateId
 *   ProcessorName String,
 *   ProcessorType String,
 *   EventId String,
 *   Status String,
 *   EventTimestamp UInt64,
 *   SequenceNumber UInt64, -- Sequence number of last processed event within aggregate (1-indexed)
 *   ProcessedAt Nullable(UInt64),
 *   FailedAt Nullable(UInt64),
 *   ErrorMessage Nullable(String),
 *   TenantId String,
 *   AggregateType String,
 *   AggregateId String,
 *   UpdatedAt DateTime DEFAULT now()
 * ) ENGINE = ReplacingMergeTree(UpdatedAt)
 * PARTITION BY (TenantId, AggregateType)
 * ORDER BY (CheckpointKey);
 * Note: ReplacingMergeTree will keep the row with the highest UpdatedAt value for each CheckpointKey.
 * ```
 */
export class ProcessorCheckpointStoreClickHouse
  implements ProcessorCheckpointStore
{
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.checkpoint-store.clickhouse",
  );
  private readonly logger = createLogger(
    "langwatch:event-sourcing:checkpoint-store:clickhouse",
  );

  constructor(private readonly repository: CheckpointRepository) {}

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
      "ProcessorCheckpointStoreClickHouse.saveCheckpoint",
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

    return await this.tracer.withActiveSpan(
      "ProcessorCheckpointStoreClickHouse.saveCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "processor.name": processorName,
          "processor.type": processorType,
          "event.id": event.id,
          status: status,
          "tenant.id": event.tenantId,
          "aggregate.type": event.aggregateType,
          "aggregate.id": String(event.aggregateId),
        },
      },
      async () => {
        try {
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

          this.logger.debug(
            {
              processorName,
              processorType,
              eventId: event.id,
              status,
              tenantId: event.tenantId,
              aggregateType: event.aggregateType,
              aggregateId: String(event.aggregateId),
            },
            "Saved checkpoint to ClickHouse",
          );
        } catch (error) {
          this.logger.error(
            {
              processorName,
              processorType,
              eventId: event.id,
              status,
              tenantId: event.tenantId,
              aggregateType: event.aggregateType,
              aggregateId: String(event.aggregateId),
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
            },
            "Failed to save checkpoint to ClickHouse",
          );
          throw error;
        }
      },
    );
  }

  async loadCheckpoint(
    checkpointKey: string,
  ): Promise<ProcessorCheckpoint | null> {
    return await this.tracer.withActiveSpan(
      "ProcessorCheckpointStoreClickHouse.loadCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "checkpoint.key": checkpointKey,
        },
      },
      async () => {
        try {
          // Get record from repository
          const record =
            await this.repository.getCheckpointRecord(checkpointKey);

          if (!record) {
            return null;
          }

          // Transform to checkpoint
          return this.recordToCheckpoint(record);
        } catch (error) {
          this.logger.error(
            {
              checkpointKey,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
            },
            "Failed to load checkpoint from ClickHouse",
          );
          throw error;
        }
      },
    );
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
      "ProcessorCheckpointStoreClickHouse.getLastProcessedEvent",
    );

    return await this.tracer.withActiveSpan(
      "ProcessorCheckpointStoreClickHouse.getLastProcessedEvent",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "pipeline.name": pipelineName,
          "processor.name": processorName,
          "processor.type": processorType,
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "aggregate.id": aggregateId,
        },
      },
      async () => {
        try {
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
            await this.repository.getLastProcessedCheckpointRecord(
              checkpointKey,
            );

          if (!record) {
            return null;
          }

          // Transform to checkpoint
          return this.recordToCheckpoint(record);
        } catch (error) {
          this.logger.error(
            {
              processorName,
              processorType,
              tenantId,
              aggregateType,
              aggregateId,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
            },
            "Failed to get last processed event from ClickHouse",
          );
          throw error;
        }
      },
    );
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
      "ProcessorCheckpointStoreClickHouse.getCheckpointBySequenceNumber",
    );

    return await this.tracer.withActiveSpan(
      "ProcessorCheckpointStoreClickHouse.getCheckpointBySequenceNumber",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "pipeline.name": pipelineName,
          "processor.name": processorName,
          "processor.type": processorType,
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "aggregate.id": aggregateId,
          "sequence.number": sequenceNumber,
        },
      },
      async () => {
        try {
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
            await this.repository.getCheckpointRecordBySequenceNumber(
              checkpointKey,
              sequenceNumber,
            );

          if (!record) {
            return null;
          }

          // Transform to checkpoint
          return this.recordToCheckpoint(record);
        } catch (error) {
          this.logger.error(
            {
              processorName,
              processorType,
              tenantId,
              aggregateType,
              aggregateId,
              sequenceNumber,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
            },
            "Failed to get checkpoint by sequence number from ClickHouse",
          );
          throw error;
        }
      },
    );
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
      "ProcessorCheckpointStoreClickHouse.hasFailedEvents",
    );

    return await this.tracer.withActiveSpan(
      "ProcessorCheckpointStoreClickHouse.hasFailedEvents",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "pipeline.name": pipelineName,
          "processor.name": processorName,
          "processor.type": processorType,
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "aggregate.id": aggregateId,
        },
      },
      async () => {
        try {
          // Build checkpoint key (business logic in store layer)
          const checkpointKey = buildCheckpointKey(
            tenantId,
            pipelineName,
            processorName,
            aggregateType,
            aggregateId,
          );

          // Delegate to repository
          return await this.repository.hasFailedCheckpointRecords(
            checkpointKey,
          );
        } catch (error) {
          this.logger.error(
            {
              processorName,
              processorType,
              tenantId,
              aggregateType,
              aggregateId,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
            },
            "Failed to check for failed events in ClickHouse",
          );
          throw error;
        }
      },
    );
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
      "ProcessorCheckpointStoreClickHouse.getFailedEvents",
    );

    return await this.tracer.withActiveSpan(
      "ProcessorCheckpointStoreClickHouse.getFailedEvents",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "pipeline.name": pipelineName,
          "processor.name": processorName,
          "processor.type": processorType,
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "aggregate.id": aggregateId,
        },
      },
      async () => {
        try {
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
        } catch (error) {
          this.logger.error(
            {
              processorName,
              processorType,
              tenantId,
              aggregateType,
              aggregateId,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
            },
            "Failed to get failed events from ClickHouse",
          );
          throw error;
        }
      },
    );
  }

  async clearCheckpoint(
    tenantId: TenantId,
    checkpointKey: string,
  ): Promise<void> {
    // Validate tenantId
    EventUtils.validateTenantId(
      { tenantId },
      "ProcessorCheckpointStoreClickHouse.clearCheckpoint",
    );

    // Parse checkpointKey to extract tenantId for verification
    const parsedKey = parseCheckpointKey(checkpointKey);

    // Verify tenantId matches the tenantId in checkpointKey
    if (tenantId.toString() !== parsedKey.tenantId.toString()) {
      throw new Error(
        `TenantId mismatch: provided tenantId (${tenantId.toString()}) does not match checkpointKey tenantId (${parsedKey.tenantId.toString()})`,
      );
    }

    return await this.tracer.withActiveSpan(
      "ProcessorCheckpointStoreClickHouse.clearCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "checkpoint.key": checkpointKey,
          "tenant.id": tenantId.toString(),
        },
      },
      async () => {
        try {
          // Delegate to repository
          await this.repository.deleteCheckpointRecord(checkpointKey);

          this.logger.debug(
            {
              checkpointKey,
            },
            "Cleared checkpoint from ClickHouse",
          );
        } catch (error) {
          this.logger.error(
            {
              checkpointKey,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
            },
            "Failed to clear checkpoint from ClickHouse",
          );
          throw error;
        }
      },
    );
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
