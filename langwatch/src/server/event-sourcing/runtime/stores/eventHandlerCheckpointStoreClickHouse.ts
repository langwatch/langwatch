import { type ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { EventHandlerCheckpointStore } from "../../library/stores/eventHandlerCheckpointStore.types";
import type { EventHandlerCheckpoint } from "../../library/domain/types";
import type { TenantId } from "../../library/domain/tenantId";
import type { AggregateType } from "../../library/domain/aggregateType";
import { EventUtils } from "../../library";
import { createLogger } from "../../../../utils/logger";

interface CheckpointRecord {
  TenantId: string;
  HandlerName: string;
  AggregateType: string;
  AggregateId: string;
  LastProcessedTimestamp: number;
  LastProcessedEventId: string;
}

/**
 * ClickHouse implementation of EventHandlerCheckpointStore.
 * Provides distributed checkpoint storage for multi-instance deployments.
 *
 * **Table Schema:**
 * ```sql
 * CREATE TABLE IF NOT EXISTS event_handler_checkpoints (
 *   TenantId String,
 *   HandlerName String,
 *   AggregateType String,
 *   AggregateId String,
 *   LastProcessedTimestamp UInt64,
 *   LastProcessedEventId String,
 *   UpdatedAt DateTime DEFAULT now()
 * ) ENGINE = ReplacingMergeTree(UpdatedAt)
 * PARTITION BY (TenantId, AggregateType)
 * ORDER BY (TenantId, HandlerName, AggregateType, AggregateId);
 * ```
 */
export class EventHandlerCheckpointStoreClickHouse
  implements EventHandlerCheckpointStore
{
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.checkpoint-store.clickhouse",
  );
  private readonly logger = createLogger(
    "langwatch:event-sourcing:checkpoint-store:clickhouse",
  );

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async saveCheckpoint(
    handlerName: string,
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
    checkpoint: EventHandlerCheckpoint,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId },
      "EventHandlerCheckpointStoreClickHouse.saveCheckpoint",
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

    return await this.tracer.withActiveSpan(
      "EventHandlerCheckpointStoreClickHouse.saveCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "handler.name": handlerName,
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "aggregate.id": aggregateId,
        },
      },
      async () => {
        try {
          const record: CheckpointRecord = {
            TenantId: tenantId,
            HandlerName: handlerName,
            AggregateType: aggregateType,
            AggregateId: aggregateId,
            LastProcessedTimestamp: checkpoint.lastProcessedTimestamp,
            LastProcessedEventId: checkpoint.lastProcessedEventId,
          };

          await this.clickHouseClient.insert({
            table: "event_handler_checkpoints",
            values: [record],
            format: "JSONEachRow",
          });

          this.logger.debug(
            {
              handlerName,
              tenantId,
              aggregateType,
              aggregateId,
              lastProcessedEventId: checkpoint.lastProcessedEventId,
            },
            "Saved checkpoint to ClickHouse",
          );
        } catch (error) {
          this.logger.error(
            {
              handlerName,
              tenantId,
              aggregateType,
              aggregateId,
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
    handlerName: string,
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<EventHandlerCheckpoint | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "EventHandlerCheckpointStoreClickHouse.loadCheckpoint",
    );

    return await this.tracer.withActiveSpan(
      "EventHandlerCheckpointStoreClickHouse.loadCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "handler.name": handlerName,
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "aggregate.id": aggregateId,
        },
      },
      async () => {
        try {
          // Use FINAL to get the latest version from ReplacingMergeTree
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                AggregateId,
                LastProcessedTimestamp,
                LastProcessedEventId
              FROM event_handler_checkpoints FINAL
              WHERE TenantId = {tenantId:String}
                AND HandlerName = {handlerName:String}
                AND AggregateType = {aggregateType:String}
                AND AggregateId = {aggregateId:String}
              LIMIT 1
            `,
            query_params: {
              tenantId,
              handlerName,
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

          const checkpoint: EventHandlerCheckpoint = {
            handlerName,
            tenantId,
            aggregateType,
            lastProcessedAggregateId: row.AggregateId,
            lastProcessedTimestamp: row.LastProcessedTimestamp,
            lastProcessedEventId: row.LastProcessedEventId,
          };

          return checkpoint;
        } catch (error) {
          this.logger.error(
            {
              handlerName,
              tenantId,
              aggregateType,
              aggregateId,
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

  async clearCheckpoint(
    handlerName: string,
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId },
      "EventHandlerCheckpointStoreClickHouse.clearCheckpoint",
    );

    return await this.tracer.withActiveSpan(
      "EventHandlerCheckpointStoreClickHouse.clearCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "handler.name": handlerName,
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "aggregate.id": aggregateId,
        },
      },
      async () => {
        try {
          // Delete checkpoint using ALTER DELETE
          await this.clickHouseClient.command({
            query: `
              ALTER TABLE event_handler_checkpoints
              DELETE WHERE TenantId = {tenantId:String}
                AND HandlerName = {handlerName:String}
                AND AggregateType = {aggregateType:String}
                AND AggregateId = {aggregateId:String}
            `,
            query_params: {
              tenantId,
              handlerName,
              aggregateType,
              aggregateId,
            },
          });

          this.logger.debug(
            {
              handlerName,
              tenantId,
              aggregateType,
              aggregateId,
            },
            "Cleared checkpoint from ClickHouse",
          );
        } catch (error) {
          this.logger.error(
            {
              handlerName,
              tenantId,
              aggregateType,
              aggregateId,
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
