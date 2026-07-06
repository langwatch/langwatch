import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { ExperimentAnalyticsRow } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentAnalytics.foldProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { ExperimentAnalyticsRepository } from "./experiment-analytics.repository";

const TABLE_NAME = "experiment_analytics" as const;

const logger = createLogger(
  "langwatch:app-layer:experiments:experiment-analytics-repository",
);

/**
 * ClickHouse write shape for the slim `experiment_analytics` table
 * (ADR-034 Phase 7, migration 00044).
 *
 * `TotalDurationMs` is Int64 — serialised as a STRING in JSONEachRow for the
 * same precision reason the trace + eval slim use. `TotalCost`, `AvgScoreBps`,
 * `PassRateBps` are Nullable; UInt32 counters fit in JSON numbers.
 */
interface ClickHouseExperimentAnalyticsWriteRecord {
  TenantId: string;
  RunId: string;
  Version: string;
  OccurredAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;

  ExperimentId: string;
  WorkflowVersionId: string | null;
  CompletionMode: string;

  Total: number;
  Progress: number;
  CompletedCount: number;
  FailedCount: number;
  TotalCost: number | null;
  TotalDurationMs: string | null;
  AvgScoreBps: number | null;
  PassRateBps: number | null;

  Attributes: Record<string, string>;

  _retention_days: number;
}

function toClickHouseRecord(
  row: ExperimentAnalyticsRow,
  retentionDays: number,
): ClickHouseExperimentAnalyticsWriteRecord {
  return {
    TenantId: row.tenantId,
    RunId: row.runId,
    Version: row.version,
    OccurredAt: new Date(row.occurredAtMs),
    CreatedAt: new Date(row.createdAtMs),
    UpdatedAt: new Date(row.updatedAtMs),

    ExperimentId: row.experimentId,
    WorkflowVersionId: row.workflowVersionId,
    CompletionMode: row.completionMode,

    Total: row.total,
    Progress: row.progress,
    CompletedCount: row.completedCount,
    FailedCount: row.failedCount,
    TotalCost: row.totalCost,
    TotalDurationMs:
      row.totalDurationMs == null
        ? null
        : String(Math.round(row.totalDurationMs)),
    AvgScoreBps: row.avgScoreBps,
    PassRateBps: row.passRateBps,

    Attributes: row.attributes,

    _retention_days: retentionDays,
  };
}

export class ExperimentAnalyticsClickHouseRepository
  implements ExperimentAnalyticsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsert(
    row: ExperimentAnalyticsRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "ExperimentAnalyticsClickHouseRepository.upsert",
    );

    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [toClickHouseRecord(row, retentionDays)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId: row.tenantId,
          runId: row.runId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to upsert experiment_analytics row into ClickHouse",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{ row: ExperimentAnalyticsRow; retentionDays?: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.row.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "ExperimentAnalyticsClickHouseRepository.upsertBatch",
    );
    for (const { row } of entries) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "ExperimentAnalyticsClickHouseRepository.upsertBatch",
          "all rows in a single batch must share the same tenantId",
          tenantId,
          { mismatchedTenantId: row.tenantId },
        );
      }
    }

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: entries.map(({ row, retentionDays }) =>
          toClickHouseRecord(
            row,
            retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
          ),
        ),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId,
          count: entries.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to batch upsert experiment_analytics rows into ClickHouse",
      );
      throw error;
    }
  }
}
