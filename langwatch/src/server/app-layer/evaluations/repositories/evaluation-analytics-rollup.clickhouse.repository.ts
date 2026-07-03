import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { BaseAnalyticsRollupClickHouseRepository } from "~/server/app-layer/analytics/repositories/analyticsWriteBase";
import type { EvaluationAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalyticsRollup.mapProjection";
import type { EvaluationAnalyticsRollupRepository } from "./evaluation-analytics-rollup.repository";

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
  extends BaseAnalyticsRollupClickHouseRepository<
    EvaluationAnalyticsRollupRow,
    ClickHouseEvaluationRollupWriteRecord
  >
  implements EvaluationAnalyticsRollupRepository
{
  constructor(resolveClient: ClickHouseClientResolver) {
    super(resolveClient, {
      tableName: "evaluation_analytics_rollup",
      loggerName:
        "langwatch:app-layer:evaluations:evaluation-analytics-rollup-repository",
      entityIdOf: () => ({}),
      toRecord: toClickHouseRecord,
    });
  }
}
