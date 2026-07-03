import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { BaseAnalyticsRollupClickHouseRepository } from "~/server/app-layer/analytics/repositories/analyticsWriteBase";
import type { SuiteAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteAnalyticsRollup.mapProjection";
import type { SuiteAnalyticsRollupRepository } from "./suite-analytics-rollup.repository";

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
  extends BaseAnalyticsRollupClickHouseRepository<
    SuiteAnalyticsRollupRow,
    ClickHouseSuiteRollupWriteRecord
  >
  implements SuiteAnalyticsRollupRepository
{
  constructor(resolveClient: ClickHouseClientResolver) {
    super(resolveClient, {
      tableName: "suite_analytics_rollup",
      loggerName:
        "langwatch:app-layer:suites:suite-analytics-rollup-repository",
      entityIdOf: () => ({}),
      toRecord: toClickHouseRecord,
    });
  }
}
