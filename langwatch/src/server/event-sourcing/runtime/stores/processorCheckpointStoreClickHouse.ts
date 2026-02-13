import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../utils/logger/server";
import { EventUtils } from "../../library";
import type { AggregateType } from "../../library/domain/aggregateType";
import type { TenantId } from "../../library/domain/tenantId";
import type { Event, ProcessorCheckpoint } from "../../library/domain/types";
import type { CheckpointStore } from "../../library/stores/checkpointStore.types";
import {
  buildCheckpointKey,
  parseCheckpointKey,
} from "../../library/utils/checkpointKey";
import type { CheckpointCacheRedis } from "./checkpointCacheRedis";
import type {
  CheckpointRecord,
  CheckpointRepository,
} from "./repositories/checkpointRepository.types";

/**
 * ClickHouse implementation of ProcessorCheckpointStore.
 * Provides distributed checkpoint storage for multi-instance deployments.
 *
 * Optionally uses Redis cache for immediate checkpoint visibility,
 * solving ClickHouse's eventual consistency lag with ReplacingMergeTree + FINAL.
 *
 * **Checkpoint Versioning:**
 * - Uses ReplacingMergeTree with SequenceNumber as version column for correct ordering
 * - ORDER BY (TenantId, CheckpointKey, Status) - separates failed checkpoints from normal ones
 * - Failed checkpoints persist independently and block all future events for that aggregate
 * - Normal checkpoints (processed/pending) replace each other based on SequenceNumber
 * - ReplacingMergeTree merges automatically remove superseded versions within each Status partition
 * - No TTL DELETE - latest checkpoints are never deleted
 *
 * **Failure Handling:**
 * - When an event fails, it creates a failed checkpoint that persists until manually cleared
 * - Failed checkpoints block ALL future events for that aggregate (checked via hasFailedEvents())
 * - The same failed event can retry and succeed, which clears the failure and unblocks processing
 * - Use getFailedEvents() to retrieve failures requiring review
 * - Use clearCheckpoint() to manually clear a failure after investigation
 *
 * Schema in /server/clickhouse/migrations/00003_create_processor_checkpoints.sql
 */
export class ProcessorCheckpointStoreClickHouse implements CheckpointStore {
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.checkpoint-store.clickhouse",
  );
  private readonly logger = createLogger(
    "langwatch:event-sourcing:checkpoint-store:clickhouse",
  );

  constructor(
    private readonly repository: CheckpointRepository,
    private readonly cache?: CheckpointCacheRedis,
  ) {}

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

          // Cache checkpoint immediately after ClickHouse insert for fast reads
          if (this.cache) {
            const cachedData = {
              sequenceNumber,
              status,
              eventId: event.id,
              timestamp: event.timestamp,
              processorType,
            };
            await this.cache.set(checkpointKey, cachedData);
            await this.cache.setByCheckpointKey(checkpointKey, cachedData);

            if (status === "failed") {
              await this.cache.setFailureStatus(checkpointKey, true);
            } else if (status === "processed") {
              await this.cache.setFailureStatus(checkpointKey, false);
            }
          }

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
          // Check Redis cache first for fast reads
          if (this.cache) {
            const cached =
              await this.cache.getByCheckpointKey(checkpointKey);
            if (cached) {
              const parsedKey = parseCheckpointKey(checkpointKey);
              return {
                processorName: parsedKey.processorName,
                processorType: cached.processorType ?? "handler",
                eventId: cached.eventId,
                status: cached.status,
                eventTimestamp: cached.timestamp,
                sequenceNumber: cached.sequenceNumber,
                processedAt: void 0,
                failedAt: void 0,
                errorMessage: void 0,
                tenantId: parsedKey.tenantId,
                aggregateType: parsedKey.aggregateType as AggregateType,
                aggregateId: parsedKey.aggregateId,
              };
            }
          }

          // Fallback to ClickHouse
          const parsedKeyForQuery = parseCheckpointKey(checkpointKey);
          const record = await this.repository.getCheckpointRecord(
            checkpointKey,
            parsedKeyForQuery.tenantId,
          );

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
              tenantId,
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

          // Check cache first for fast reads
          if (this.cache) {
            const cached = await this.cache.get(checkpointKey);
            if (cached && cached.sequenceNumber >= sequenceNumber) {
              // Match the ClickHouse query semantics:
              // 1. "processed" checkpoint with seq >= requested means requested seq is done
              // 2. "pending" checkpoint with seq > requested means requested seq must be done
              //    (otherwise the higher sequence couldn't have started)
              // 3. "pending" checkpoint with seq = requested means it's STILL processing - NOT valid
              const isValid =
                cached.status === "processed" ||
                (cached.status === "pending" &&
                  cached.sequenceNumber > sequenceNumber);

              if (isValid) {
                // Cache hit - convert to full checkpoint format
                this.logger.debug(
                  {
                    processorName,
                    processorType,
                    tenantId,
                    aggregateType,
                    aggregateId,
                    sequenceNumber,
                    cachedSequence: cached.sequenceNumber,
                    cachedStatus: cached.status,
                  },
                  "Found checkpoint in cache",
                );

                // If we found a pending checkpoint for a HIGHER sequence, convert the result
                // to indicate the requested sequence is processed (since it must be for the
                // higher sequence to have started)
                // This matches the logic in getCheckpointRecordBySequenceNumber
                if (
                  cached.status === "pending" &&
                  cached.sequenceNumber > sequenceNumber
                ) {
                  return {
                    processorName,
                    processorType,
                    eventId: cached.eventId,
                    status: "processed" as const,
                    eventTimestamp: cached.timestamp,
                    sequenceNumber: sequenceNumber,
                    processedAt: void 0,
                    failedAt: void 0,
                    errorMessage: void 0,
                    tenantId,
                    aggregateType,
                    aggregateId,
                  };
                }

                return {
                  processorName,
                  processorType,
                  eventId: cached.eventId,
                  status: cached.status as "pending" | "processed" | "failed",
                  eventTimestamp: cached.timestamp,
                  sequenceNumber: cached.sequenceNumber,
                  processedAt: void 0,
                  failedAt: void 0,
                  errorMessage: void 0,
                  tenantId,
                  aggregateType,
                  aggregateId,
                };
              }
            }
          }

          // Fallback to ClickHouse
          const record =
            await this.repository.getCheckpointRecordBySequenceNumber(
              checkpointKey,
              sequenceNumber,
              tenantId,
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

          // Check Redis cache first for fast reads
          if (this.cache) {
            const cached = await this.cache.getFailureStatus(checkpointKey);
            if (cached !== null) {
              return cached;
            }
          }

          // Fallback to ClickHouse
          const hasFailed =
            await this.repository.hasFailedCheckpointRecords(
              checkpointKey,
              tenantId,
            );

          // Cache the result for future lookups
          if (this.cache) {
            await this.cache.setFailureStatus(checkpointKey, hasFailed);
          }

          return hasFailed;
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
            await this.repository.getFailedCheckpointRecords(
              checkpointKey,
              tenantId,
            );

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
          await this.repository.deleteCheckpointRecord(
            checkpointKey,
            tenantId,
          );

          // Clear all cache entries for this checkpoint key
          if (this.cache) {
            await this.cache.delete(checkpointKey);
            await this.cache.deleteFailureStatus(checkpointKey);
          }

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
