import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { BaseAnalyticsRollupClickHouseRepository } from "~/server/app-layer/analytics/repositories/analyticsWriteBase";
import type { ExperimentAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentAnalyticsRollup.mapProjection";
import type { ExperimentAnalyticsRollupRepository } from "./experiment-analytics-rollup.repository";

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
  extends BaseAnalyticsRollupClickHouseRepository<
    ExperimentAnalyticsRollupRow,
    ClickHouseExperimentRollupWriteRecord
  >
  implements ExperimentAnalyticsRollupRepository
{
  constructor(resolveClient: ClickHouseClientResolver) {
    super(resolveClient, {
      tableName: "experiment_analytics_rollup",
      loggerName:
        "langwatch:app-layer:experiments:experiment-analytics-rollup-repository",
      entityIdOf: () => ({}),
      toRecord: toClickHouseRecord,
    });
  }
}
