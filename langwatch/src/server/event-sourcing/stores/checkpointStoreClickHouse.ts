import { type ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { CheckpointStore, BulkRebuildCheckpoint } from "../library";
import { EventUtils } from "../library";
import { createLogger } from "../../../utils/logger";

interface CheckpointRow {
  Cursor?: string | null;
  LastAggregateId?: string | null;
  ProcessedCount?: string | number | null;
}

/**
 * ClickHouse implementation of checkpoint store.
 *
 * In event sourcing, "store" is the common term for persistence abstractions
 * (as opposed to "repository" which is more common in DDD/CRUD contexts).
 */
export class CheckpointStoreClickHouse implements CheckpointStore<string> {
  tracer = getLangWatchTracer(
    "langwatch.trace-processing.checkpoint-store.clickhouse",
  );
  logger = createLogger(
    "langwatch:trace-processing:checkpoint-store:clickhouse",
  );

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async saveCheckpoint(
    tenantId: string,
    aggregateType: string,
    checkpoint: BulkRebuildCheckpoint<string>,
  ): Promise<void> {
    // Validate tenant context
    EventUtils.validateTenantId(
      { tenantId },
      "CheckpointStoreClickHouse.saveCheckpoint",
    );

    return await this.tracer.withActiveSpan(
      "CheckpointStoreClickHouse.saveCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
          "checkpoint.processed_count": checkpoint.processedCount,
        },
      },
      async () => {
        try {
          await this.clickHouseClient.insert({
            table: "event_log_checkpoints",
            values: [
              {
                TenantId: String(tenantId),
                AggregateType: String(aggregateType),
                Cursor: checkpoint.cursor ? String(checkpoint.cursor) : "",
                LastAggregateId: checkpoint.lastAggregateId
                  ? String(checkpoint.lastAggregateId)
                  : "",
                ProcessedCount: Number(checkpoint.processedCount),
                UpdatedAt: Date.now(),
              },
            ],
            format: "JSONEachRow",
          });

          this.logger.info(
            {
              tenantId,
              aggregateType,
              processedCount: checkpoint.processedCount,
              cursor: checkpoint.cursor ?? "none",
            },
            "Saved checkpoint",
          );
        } catch (error) {
          this.logger.error(
            {
              tenantId,
              aggregateType,
              processedCount: checkpoint.processedCount,
              cursor: checkpoint.cursor ?? "none",
              lastAggregateId: checkpoint.lastAggregateId
                ? String(checkpoint.lastAggregateId)
                : "none",
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
              errorName: error instanceof Error ? error.name : void 0,
            },
            "Failed to save checkpoint",
          );
          throw error;
        }
      },
    );
  }

  async loadCheckpoint(
    tenantId: string,
    aggregateType: string,
  ): Promise<BulkRebuildCheckpoint<string> | null> {
    // Validate tenant context
    EventUtils.validateTenantId(
      { tenantId },
      "CheckpointStoreClickHouse.loadCheckpoint",
    );

    return await this.tracer.withActiveSpan(
      "CheckpointStoreClickHouse.loadCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
        },
      },
      async () => {
        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT *
              FROM event_log_checkpoints
              WHERE TenantId = {tenantId:String}
                AND AggregateType = {aggregateType:String}
              ORDER BY UpdatedAt DESC
              LIMIT 1
            `,
            query_params: {
              tenantId,
              aggregateType,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<CheckpointRow>();
          if (rows.length === 0) {
            return null;
          }

          const row = rows[0];
          if (!row) {
            return null;
          }

          const checkpoint: BulkRebuildCheckpoint<string> = {
            cursor: row.Cursor && row.Cursor.length > 0 ? row.Cursor : void 0,
            lastAggregateId:
              row.LastAggregateId && row.LastAggregateId.length > 0
                ? row.LastAggregateId
                : void 0,
            processedCount: Number(row.ProcessedCount),
          };

          this.logger.debug(
            {
              tenantId,
              aggregateType,
              processedCount: checkpoint.processedCount,
            },
            "Loaded checkpoint",
          );

          return checkpoint;
        } catch (error) {
          this.logger.error(
            {
              tenantId,
              aggregateType,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
              errorName: error instanceof Error ? error.name : void 0,
            },
            "Failed to load checkpoint",
          );
          throw error;
        }
      },
    );
  }

  async clearCheckpoint(
    tenantId: string,
    aggregateType: string,
  ): Promise<void> {
    // Validate tenant context
    EventUtils.validateTenantId(
      { tenantId },
      "CheckpointStoreClickHouse.clearCheckpoint",
    );

    return await this.tracer.withActiveSpan(
      "CheckpointStoreClickHouse.clearCheckpoint",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "aggregate.type": aggregateType,
        },
      },
      async () => {
        try {
          // ClickHouse doesn't support DELETE directly in ReplacingMergeTree
          // Instead, we insert a row with ProcessedCount = 0 to effectively reset
          await this.clickHouseClient.insert({
            table: "event_log_checkpoints",
            values: [
              {
                TenantId: String(tenantId),
                AggregateType: String(aggregateType),
                Cursor: "",
                LastAggregateId: "",
                ProcessedCount: 0,
                UpdatedAt: Date.now(),
              },
            ],
            format: "JSONEachRow",
          });

          this.logger.info(
            {
              tenantId,
              aggregateType,
            },
            "Cleared checkpoint",
          );
        } catch (error) {
          this.logger.error(
            {
              tenantId,
              aggregateType,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
              errorName: error instanceof Error ? error.name : void 0,
            },
            "Failed to clear checkpoint",
          );
          throw error;
        }
      },
    );
  }
}

