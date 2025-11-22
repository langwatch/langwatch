import { type ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { ProcessorCheckpointStore } from "../../library/stores/eventHandlerCheckpointStore.types";
import type { Event, ProcessorCheckpoint } from "../../library/domain/types";
import type { TenantId } from "../../library/domain/tenantId";
import type { AggregateType } from "../../library/domain/aggregateType";
import { EventUtils } from "../../library";
import { createLogger } from "../../../../utils/logger";

interface CheckpointRecord {
  CheckpointKey: string; // processorName:eventId
  ProcessorName: string;
  ProcessorType: "handler" | "projection";
  EventId: string;
  Status: "processed" | "failed" | "pending";
  EventTimestamp: number;
  SequenceNumber: number;
  ProcessedAt: number | null;
  FailedAt: number | null;
  ErrorMessage: string | null;
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
}

/**
 * ClickHouse implementation of ProcessorCheckpointStore.
 * Provides distributed checkpoint storage for multi-instance deployments.
 *
 * **Table Schema:**
 * ```sql
 * CREATE TABLE IF NOT EXISTS processor_checkpoints (
 *   CheckpointKey String, -- Primary key: processorName:eventId
 *   ProcessorName String,
 *   ProcessorType String,
 *   EventId String,
 *   Status String,
 *   EventTimestamp UInt64,
 *   SequenceNumber UInt64, -- Sequence number of event within aggregate (1-indexed)
 *   ProcessedAt Nullable(UInt64),
 *   FailedAt Nullable(UInt64),
 *   ErrorMessage Nullable(String),
 *   TenantId String,
 *   AggregateType String,
 *   AggregateId String,
 *   UpdatedAt DateTime DEFAULT now()
 * ) ENGINE = ReplacingMergeTree(UpdatedAt)
 * PARTITION BY (TenantId, AggregateType)
 * ORDER BY (CheckpointKey, TenantId, ProcessorName, ProcessorType, AggregateType, AggregateId, EventTimestamp);
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

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

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
      "ProcessorCheckpointStoreClickHouse.saveCheckpoint",
    );

    const checkpointKey = `${processorName}:${event.id}`;
    const now = Date.now();

    return await this.tracer.withActiveSpan(
      "ProcessorCheckpointStoreClickHouse.saveCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "processor.name": processorName,
          "processor.type": processorType,
          "event.id": event.id,
          "status": status,
          "tenant.id": event.tenantId,
          "aggregate.type": event.aggregateType,
          "aggregate.id": String(event.aggregateId),
        },
      },
      async () => {
        try {
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
            ErrorMessage: status === "failed" ? errorMessage ?? null : null,
            TenantId: event.tenantId,
            AggregateType: event.aggregateType,
            AggregateId: String(event.aggregateId),
          };

          await this.clickHouseClient.insert({
            table: "processor_checkpoints",
            values: [record],
            format: "JSONEachRow",
          });

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
    processorName: string,
    processorType: "handler" | "projection",
    eventId: string,
  ): Promise<ProcessorCheckpoint | null> {
    const checkpointKey = `${processorName}:${eventId}`;

    return await this.tracer.withActiveSpan(
      "ProcessorCheckpointStoreClickHouse.loadCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "processor.name": processorName,
          "processor.type": processorType,
          "event.id": eventId,
        },
      },
      async () => {
        try {
          // Use FINAL to get the latest version from ReplacingMergeTree
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                ProcessorName,
                ProcessorType,
                EventId,
                Status,
                EventTimestamp,
                SequenceNumber,
                ProcessedAt,
                FailedAt,
                ErrorMessage,
                TenantId,
                AggregateType,
                AggregateId
              FROM processor_checkpoints FINAL
              WHERE CheckpointKey = {checkpointKey:String}
              LIMIT 1
            `,
            query_params: {
              checkpointKey,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<CheckpointRecord>();
          const row = rows[0];

          if (!row) {
            return null;
          }

          const checkpoint: ProcessorCheckpoint = {
            processorName: row.ProcessorName,
            processorType: row.ProcessorType,
            eventId: row.EventId,
            status: row.Status,
            eventTimestamp: row.EventTimestamp,
            sequenceNumber: row.SequenceNumber,
            processedAt: row.ProcessedAt ?? void 0,
            failedAt: row.FailedAt ?? void 0,
            errorMessage: row.ErrorMessage ?? void 0,
            tenantId: row.TenantId as TenantId,
            aggregateType: row.AggregateType as AggregateType,
            aggregateId: row.AggregateId,
          };

          return checkpoint;
        } catch (error) {
          this.logger.error(
            {
              processorName,
              processorType,
              eventId,
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
          "processor.name": processorName,
          "processor.type": processorType,
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "aggregate.id": aggregateId,
        },
      },
      async () => {
        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                ProcessorName,
                ProcessorType,
                EventId,
                Status,
                EventTimestamp,
                SequenceNumber,
                ProcessedAt,
                FailedAt,
                ErrorMessage,
                TenantId,
                AggregateType,
                AggregateId
              FROM processor_checkpoints FINAL
              WHERE TenantId = {tenantId:String}
                AND ProcessorName = {processorName:String}
                AND ProcessorType = {processorType:String}
                AND AggregateType = {aggregateType:String}
                AND AggregateId = {aggregateId:String}
                AND Status = 'processed'
              ORDER BY EventTimestamp DESC
              LIMIT 1
            `,
            query_params: {
              tenantId,
              processorName,
              processorType,
              aggregateType,
              aggregateId,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<CheckpointRecord>();
          const row = rows[0];

          if (!row) {
            return null;
          }

          const checkpoint: ProcessorCheckpoint = {
            processorName: row.ProcessorName,
            processorType: row.ProcessorType,
            eventId: row.EventId,
            status: row.Status,
            eventTimestamp: row.EventTimestamp,
            sequenceNumber: row.SequenceNumber,
            processedAt: row.ProcessedAt ?? void 0,
            failedAt: row.FailedAt ?? void 0,
            errorMessage: row.ErrorMessage ?? void 0,
            tenantId: row.TenantId as TenantId,
            aggregateType: row.AggregateType as AggregateType,
            aggregateId: row.AggregateId,
          };

          return checkpoint;
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
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                ProcessorName,
                ProcessorType,
                EventId,
                Status,
                EventTimestamp,
                SequenceNumber,
                ProcessedAt,
                FailedAt,
                ErrorMessage,
                TenantId,
                AggregateType,
                AggregateId
              FROM processor_checkpoints FINAL
              WHERE TenantId = {tenantId:String}
                AND ProcessorName = {processorName:String}
                AND ProcessorType = {processorType:String}
                AND AggregateType = {aggregateType:String}
                AND AggregateId = {aggregateId:String}
                AND SequenceNumber = {sequenceNumber:UInt64}
                AND Status = 'processed'
              LIMIT 1
            `,
            query_params: {
              tenantId,
              processorName,
              processorType,
              aggregateType,
              aggregateId,
              sequenceNumber,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<CheckpointRecord>();
          const row = rows[0];

          if (!row) {
            return null;
          }

          const checkpoint: ProcessorCheckpoint = {
            processorName: row.ProcessorName,
            processorType: row.ProcessorType,
            eventId: row.EventId,
            status: row.Status,
            eventTimestamp: row.EventTimestamp,
            sequenceNumber: row.SequenceNumber,
            processedAt: row.ProcessedAt ?? void 0,
            failedAt: row.FailedAt ?? void 0,
            errorMessage: row.ErrorMessage ?? void 0,
            tenantId: row.TenantId as TenantId,
            aggregateType: row.AggregateType as AggregateType,
            aggregateId: row.AggregateId,
          };

          return checkpoint;
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
          "processor.name": processorName,
          "processor.type": processorType,
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "aggregate.id": aggregateId,
        },
      },
      async () => {
        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT COUNT(*) as count
              FROM processor_checkpoints FINAL
              WHERE TenantId = {tenantId:String}
                AND ProcessorName = {processorName:String}
                AND ProcessorType = {processorType:String}
                AND AggregateType = {aggregateType:String}
                AND AggregateId = {aggregateId:String}
                AND Status = 'failed'
              LIMIT 1
            `,
            query_params: {
              tenantId,
              processorName,
              processorType,
              aggregateType,
              aggregateId,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<{ count: number }>();
          const count = rows[0]?.count ?? 0;

          return count > 0;
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
          "processor.name": processorName,
          "processor.type": processorType,
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "aggregate.id": aggregateId,
        },
      },
      async () => {
        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                ProcessorName,
                ProcessorType,
                EventId,
                Status,
                EventTimestamp,
                SequenceNumber,
                ProcessedAt,
                FailedAt,
                ErrorMessage,
                TenantId,
                AggregateType,
                AggregateId
              FROM processor_checkpoints FINAL
              WHERE TenantId = {tenantId:String}
                AND ProcessorName = {processorName:String}
                AND ProcessorType = {processorType:String}
                AND AggregateType = {aggregateType:String}
                AND AggregateId = {aggregateId:String}
                AND Status = 'failed'
              ORDER BY EventTimestamp ASC
            `,
            query_params: {
              tenantId,
              processorName,
              processorType,
              aggregateType,
              aggregateId,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<CheckpointRecord>();

          return rows.map((row) => ({
            processorName: row.ProcessorName,
            processorType: row.ProcessorType,
            eventId: row.EventId,
            status: row.Status,
            eventTimestamp: row.EventTimestamp,
            sequenceNumber: row.SequenceNumber,
            processedAt: row.ProcessedAt ?? void 0,
            failedAt: row.FailedAt ?? void 0,
            errorMessage: row.ErrorMessage ?? void 0,
            tenantId: row.TenantId as TenantId,
            aggregateType: row.AggregateType as AggregateType,
            aggregateId: row.AggregateId,
          }));
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
    processorName: string,
    processorType: "handler" | "projection",
    eventId: string,
  ): Promise<void> {
    const checkpointKey = `${processorName}:${eventId}`;

    return await this.tracer.withActiveSpan(
      "ProcessorCheckpointStoreClickHouse.clearCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "processor.name": processorName,
          "processor.type": processorType,
          "event.id": eventId,
        },
      },
      async () => {
        try {
          // Delete checkpoint using ALTER DELETE
          await this.clickHouseClient.command({
            query: `
              ALTER TABLE processor_checkpoints
              DELETE WHERE CheckpointKey = {checkpointKey:String}
            `,
            query_params: {
              checkpointKey,
            },
          });

          this.logger.debug(
            {
              processorName,
              processorType,
              eventId,
            },
            "Cleared checkpoint from ClickHouse",
          );
        } catch (error) {
          this.logger.error(
            {
              processorName,
              processorType,
              eventId,
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
}
