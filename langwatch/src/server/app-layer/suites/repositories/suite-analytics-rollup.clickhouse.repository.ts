import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { SuiteAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteAnalyticsRollup.mapProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { SuiteAnalyticsRollupRepository } from "./suite-analytics-rollup.repository";

const TABLE_NAME = "suite_analytics_rollup" as const;

const logger = createLogger(
  "langwatch:app-layer:suites:suite-analytics-rollup-repository",
);

interface ClickHouseSuiteRollupWriteRecord {
  TenantId: string;
  BucketStart: Date;
  BatchRunId: string;
  Verdict: string;
  // UInt64 columns — serialize as strings.
  ItemCount: string;
  SuccessCount: string;
  FailureCount: string;
  InconclusiveCount: string;
  ErrorCount: string;
  // Int64 column — serialize as a string for the same precision reason.
  DurationSum: string;
  _retention_days: number;
}

function toClickHouseRecord(
  row: SuiteAnalyticsRollupRow,
  retentionDays: number,
): ClickHouseSuiteRollupWriteRecord {
  return {
    TenantId: row.tenantId,
    BucketStart: row.bucketStart,
    BatchRunId: row.batchRunId,
    Verdict: row.verdict,
    ItemCount: String(row.itemCount),
    SuccessCount: String(row.successCount),
    FailureCount: String(row.failureCount),
    InconclusiveCount: String(row.inconclusiveCount),
    ErrorCount: String(row.errorCount),
    DurationSum: String(row.durationSum),
    _retention_days: retentionDays,
  };
}

export class SuiteAnalyticsRollupClickHouseRepository
  implements SuiteAnalyticsRollupRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertRow(
    row: SuiteAnalyticsRollupRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "SuiteAnalyticsRollupClickHouseRepository.insertRow",
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
        "Failed to insert suite_analytics_rollup row into ClickHouse",
      );
      throw error;
    }
  }

  async insertRows(
    rows: SuiteAnalyticsRollupRow[],
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    if (rows.length === 0) return;

    for (const row of rows) {
      EventUtils.validateTenantId(
        { tenantId: row.tenantId },
        "SuiteAnalyticsRollupClickHouseRepository.insertRows",
      );
    }

    const tenantId = rows[0]!.tenantId;
    for (const row of rows) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "SuiteAnalyticsRollupClickHouseRepository.insertRows",
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
        "Failed to bulk insert suite_analytics_rollup rows into ClickHouse",
      );
      throw error;
    }
  }
}
