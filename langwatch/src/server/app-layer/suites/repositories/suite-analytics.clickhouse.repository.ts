import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { BaseAnalyticsSlimClickHouseRepository } from "~/server/app-layer/analytics/repositories/analyticsWriteBase";
import type { SuiteAnalyticsRow } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteAnalytics.foldProjection";
import type { SuiteAnalyticsRepository } from "./suite-analytics.repository";

interface ClickHouseSuiteAnalyticsWriteRecord {
  TenantId: string;
  SuiteRunId: string;
  Version: string;
  OccurredAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;

  BatchRunId: string;
  ScenarioSetId: string;
  SuiteId: string;
  Status: string;

  Total: number;
  Progress: number;
  CompletedCount: number;
  FailedCount: number;
  PassRateBps: number | null;

  Attributes: Record<string, string>;

  _retention_days: number;
}

function toClickHouseRecord(
  row: SuiteAnalyticsRow,
  retentionDays: number,
): ClickHouseSuiteAnalyticsWriteRecord {
  return {
    TenantId: row.tenantId,
    SuiteRunId: row.suiteRunId,
    Version: row.version,
    OccurredAt: new Date(row.occurredAtMs),
    CreatedAt: new Date(row.createdAtMs),
    UpdatedAt: new Date(row.updatedAtMs),

    BatchRunId: row.batchRunId,
    ScenarioSetId: row.scenarioSetId,
    SuiteId: row.suiteId,
    Status: row.status,

    Total: row.total,
    Progress: row.progress,
    CompletedCount: row.completedCount,
    FailedCount: row.failedCount,
    PassRateBps: row.passRateBps,

    Attributes: row.attributes,

    _retention_days: retentionDays,
  };
}

export class SuiteAnalyticsClickHouseRepository
  extends BaseAnalyticsSlimClickHouseRepository<
    SuiteAnalyticsRow,
    ClickHouseSuiteAnalyticsWriteRecord
  >
  implements SuiteAnalyticsRepository
{
  constructor(resolveClient: ClickHouseClientResolver) {
    super(resolveClient, {
      tableName: "suite_analytics",
      loggerName: "langwatch:app-layer:suites:suite-analytics-repository",
      entityIdOf: (row) => ({ suiteRunId: row.suiteRunId }),
      toRecord: toClickHouseRecord,
    });
  }
}
