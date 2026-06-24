import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { SimulationAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationAnalyticsRollup.mapProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { SimulationAnalyticsRollupRepository } from "./simulation-analytics-rollup.repository";

const TABLE_NAME = "simulation_analytics_rollup" as const;

const logger = createLogger(
  "langwatch:app-layer:scenarios:simulation-analytics-rollup-repository",
);

/**
 * ADR-034 Phase 7 — write-side CH repository for the scenarios rollup.
 *
 * Columns are `SimpleAggregateFunction(sum, ...)`. Inserts carry plain
 * scalars, but the JSONEachRow contract requires UInt64 / Int64 columns to
 * be serialised as STRINGS — JSON numbers can't safely round-trip a 64-bit
 * integer (precision-loss at >2^53). Float64 columns stay as numbers.
 */
interface ClickHouseSimulationRollupWriteRecord {
  TenantId: string;
  BucketStart: Date;
  Verdict: string;
  Status: string;
  // UInt64 columns — serialize as strings.
  RunCount: string;
  SuccessCount: string;
  FailureCount: string;
  InconclusiveCount: string;
  ErrorCount: string;
  // Int64 column — serialize as a string for the same precision reason.
  DurationSum: string;
  // UInt16 — small enough to fit in a JSON number.
  _retention_days: number;
}

function toClickHouseRecord(
  row: SimulationAnalyticsRollupRow,
  retentionDays: number,
): ClickHouseSimulationRollupWriteRecord {
  return {
    TenantId: row.tenantId,
    BucketStart: row.bucketStart,
    Verdict: row.verdict,
    Status: row.status,
    RunCount: String(row.runCount),
    SuccessCount: String(row.successCount),
    FailureCount: String(row.failureCount),
    InconclusiveCount: String(row.inconclusiveCount),
    ErrorCount: String(row.errorCount),
    DurationSum: String(row.durationSum),
    _retention_days: retentionDays,
  };
}

export class SimulationAnalyticsRollupClickHouseRepository
  implements SimulationAnalyticsRollupRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertRow(
    row: SimulationAnalyticsRollupRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "SimulationAnalyticsRollupClickHouseRepository.insertRow",
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
        "Failed to insert simulation_analytics_rollup row into ClickHouse",
      );
      throw error;
    }
  }

  async insertRows(
    rows: SimulationAnalyticsRollupRow[],
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    if (rows.length === 0) return;

    for (const row of rows) {
      EventUtils.validateTenantId(
        { tenantId: row.tenantId },
        "SimulationAnalyticsRollupClickHouseRepository.insertRows",
      );
    }

    const tenantId = rows[0]!.tenantId;
    for (const row of rows) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "SimulationAnalyticsRollupClickHouseRepository.insertRows",
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
        "Failed to bulk insert simulation_analytics_rollup rows into ClickHouse",
      );
      throw error;
    }
  }
}
