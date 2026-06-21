import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { ExperimentAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentAnalyticsRollup.mapProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { ExperimentAnalyticsRollupRepository } from "./experiment-analytics-rollup.repository";

const TABLE_NAME = "experiment_analytics_rollup" as const;

const logger = createLogger(
  "langwatch:app-layer:experiments:experiment-analytics-rollup-repository",
);

/**
 * ADR-034 Phase 7 — write-side CH repository for the experiments rollup.
 * Columns are `SimpleAggregateFunction(sum, UInt64)`; UInt64 columns are
 * serialised as STRINGS for JSON precision (same pattern as the trace + eval
 * rollups).
 */
interface ClickHouseExperimentRollupWriteRecord {
  TenantId: string;
  BucketStart: Date;
  ExperimentId: string;
  CompletionMode: string;
  // UInt64 columns — serialize as strings.
  RunCount: string;
  FinishedCount: string;
  StoppedCount: string;
  _retention_days: number;
}

function toClickHouseRecord(
  row: ExperimentAnalyticsRollupRow,
  retentionDays: number,
): ClickHouseExperimentRollupWriteRecord {
  return {
    TenantId: row.tenantId,
    BucketStart: row.bucketStart,
    ExperimentId: row.experimentId,
    CompletionMode: row.completionMode,
    RunCount: String(row.runCount),
    FinishedCount: String(row.finishedCount),
    StoppedCount: String(row.stoppedCount),
    _retention_days: retentionDays,
  };
}

export class ExperimentAnalyticsRollupClickHouseRepository
  implements ExperimentAnalyticsRollupRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertRow(
    row: ExperimentAnalyticsRollupRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "ExperimentAnalyticsRollupClickHouseRepository.insertRow",
    );

    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [toClickHouseRecord(row, retentionDays)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId: row.tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert experiment_analytics_rollup row into ClickHouse",
      );
      throw error;
    }
  }

  async insertRows(
    rows: ExperimentAnalyticsRollupRow[],
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    if (rows.length === 0) return;

    for (const row of rows) {
      EventUtils.validateTenantId(
        { tenantId: row.tenantId },
        "ExperimentAnalyticsRollupClickHouseRepository.insertRows",
      );
    }

    const tenantId = rows[0]!.tenantId;
    for (const row of rows) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "ExperimentAnalyticsRollupClickHouseRepository.insertRows",
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
        values: rows.map((row) => toClickHouseRecord(row, retentionDays)),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          count: rows.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to bulk insert experiment_analytics_rollup rows into ClickHouse",
      );
      throw error;
    }
  }
}
