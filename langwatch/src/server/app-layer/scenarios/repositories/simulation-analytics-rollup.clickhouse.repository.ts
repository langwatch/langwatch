import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { BaseAnalyticsRollupClickHouseRepository } from "~/server/app-layer/analytics/repositories/analyticsWriteBase";
import type { SimulationAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationAnalyticsRollup.mapProjection";
import type { SimulationAnalyticsRollupRepository } from "./simulation-analytics-rollup.repository";

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
  extends BaseAnalyticsRollupClickHouseRepository<
    SimulationAnalyticsRollupRow,
    ClickHouseSimulationRollupWriteRecord
  >
  implements SimulationAnalyticsRollupRepository
{
  constructor(resolveClient: ClickHouseClientResolver) {
    super(resolveClient, {
      tableName: "simulation_analytics_rollup",
      loggerName:
        "langwatch:app-layer:scenarios:simulation-analytics-rollup-repository",
      entityIdOf: () => ({}),
      toRecord: toClickHouseRecord,
    });
  }
}
