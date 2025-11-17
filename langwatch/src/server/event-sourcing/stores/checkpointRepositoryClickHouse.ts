import { type ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { CheckpointRepository, BulkRebuildCheckpoint } from "../library";
import { EventUtils } from "../library";
import { createLogger } from "../../../utils/logger";

/**
 * ClickHouse implementation of checkpoint repository.
 */
export class CheckpointRepositoryClickHouse
  implements CheckpointRepository<string>
{
  tracer = getLangWatchTracer(
    "langwatch.trace-processing.checkpoint-repository.clickhouse",
  );
  logger = createLogger(
    "langwatch:trace-processing:checkpoint-repository:clickhouse",
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
      "CheckpointRepositoryClickHouse.saveCheckpoint",
    );

    return await this.tracer.withActiveSpan(
      "CheckpointRepositoryClickHouse.saveCheckpoint",
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
                TenantId: tenantId,
                AggregateType: aggregateType,
                Cursor: checkpoint.cursor ?? "",
                LastAggregateId: checkpoint.lastAggregateId ?? "",
                ProcessedCount: checkpoint.processedCount,
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
      "CheckpointRepositoryClickHouse.loadCheckpoint",
    );

    return await this.tracer.withActiveSpan(
      "CheckpointRepositoryClickHouse.loadCheckpoint",
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

          const rows = (await result.json()) as Array<{
            Cursor?: string | null;
            LastAggregateId?: string | null;
            ProcessedCount?: string | number | null;
          }>;

          if (rows.length === 0) {
            return null;
          }

          const row = rows[0];
          if (!row) {
            return null;
          }

          const checkpoint: BulkRebuildCheckpoint<string> = {
            cursor: row.Cursor || void 0,
            lastAggregateId: row.LastAggregateId || void 0,
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
      "CheckpointRepositoryClickHouse.clearCheckpoint",
    );

    return await this.tracer.withActiveSpan(
      "CheckpointRepositoryClickHouse.clearCheckpoint",
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
                TenantId: tenantId,
                AggregateType: aggregateType,
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
