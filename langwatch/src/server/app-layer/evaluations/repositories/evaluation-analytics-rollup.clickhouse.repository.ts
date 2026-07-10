import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { EvaluationAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalyticsRollup.mapProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { EvaluationAnalyticsRollupRepository } from "./evaluation-analytics-rollup.repository";

const TABLE_NAME = "evaluation_analytics_rollup" as const;

const logger = createLogger(
  "langwatch:app-layer:evaluations:evaluation-analytics-rollup-repository",
);

/**
 * ADR-034 Phase 6 — write-side CH repository for the eval rollup.
 *
 * Columns are `SimpleAggregateFunction(sum, ...)`. Inserts carry plain
 * scalars, but the JSONEachRow contract requires UInt64 / Int64 columns to
 * be serialised as STRINGS — JSON numbers can't safely round-trip a 64-bit
 * integer (precision-loss at >2^53). Float64 columns stay as numbers.
 *
 * Mismatch reproduces as `CANNOT_PARSE_QUOTED_STRING: expected opening
 * quote` at insert time, so every 64-bit-integer column is typed `string`
 * below and stringified in `toClickHouseRecord`. The `async_insert` path
 * coalesces per-evaluation writes into batches at the server.
 */
interface ClickHouseEvaluationRollupWriteRecord {
  TenantId: string;
  BucketStart: Date;
  EvaluatorType: string;
  Status: string;
  // UInt64 columns — serialize as strings.
  EvalCount: string;
  PassCount: string;
  FailCount: string;
  ErrorCount: string;
  SkippedCount: string;
  ScoreCount: string;
  // Float64 columns — serialize as numbers.
  ScoreSum: number;
  CostSum: number;
  NonBilledCostSum: number;
  // Int64 column — serialize as a string for the same precision reason.
  DurationSum: string;
  // UInt16 — small enough to fit in a JSON number.
  _retention_days: number;
}

function toClickHouseRecord(
  row: EvaluationAnalyticsRollupRow,
  retentionDays: number,
): ClickHouseEvaluationRollupWriteRecord {
  return {
    TenantId: row.tenantId,
    BucketStart: row.bucketStart,
    EvaluatorType: row.evaluatorType,
    Status: row.status,
    EvalCount: String(row.evalCount),
    PassCount: String(row.passCount),
    FailCount: String(row.failCount),
    ErrorCount: String(row.errorCount),
    SkippedCount: String(row.skippedCount),
    ScoreCount: String(row.scoreCount),
    ScoreSum: row.scoreSum,
    CostSum: row.costSum,
    NonBilledCostSum: row.nonBilledCostSum,
    DurationSum: String(row.durationSum),
    _retention_days: retentionDays,
  };
}

export class EvaluationAnalyticsRollupClickHouseRepository
  implements EvaluationAnalyticsRollupRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertRow(
    row: EvaluationAnalyticsRollupRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "EvaluationAnalyticsRollupClickHouseRepository.insertRow",
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
        "Failed to insert evaluation_analytics_rollup row into ClickHouse",
      );
      throw error;
    }
  }

  async insertRows(
    rows: EvaluationAnalyticsRollupRow[],
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    if (rows.length === 0) return;

    for (const row of rows) {
      EventUtils.validateTenantId(
        { tenantId: row.tenantId },
        "EvaluationAnalyticsRollupClickHouseRepository.insertRows",
      );
    }

    const tenantId = rows[0]!.tenantId;
    for (const row of rows) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "EvaluationAnalyticsRollupClickHouseRepository.insertRows",
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
        "Failed to bulk insert evaluation_analytics_rollup rows into ClickHouse",
      );
      throw error;
    }
  }
}
