import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { SuiteAnalyticsRow } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteAnalytics.foldProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { SuiteAnalyticsRepository } from "./suite-analytics.repository";

const TABLE_NAME = "suite_analytics" as const;

const logger = createLogger(
  "langwatch:app-layer:suites:suite-analytics-repository",
);

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
  implements SuiteAnalyticsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsert(
    row: SuiteAnalyticsRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "SuiteAnalyticsClickHouseRepository.upsert",
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
          suiteRunId: row.suiteRunId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to upsert suite_analytics row into ClickHouse",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{ row: SuiteAnalyticsRow; retentionDays?: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.row.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "SuiteAnalyticsClickHouseRepository.upsertBatch",
    );
    for (const { row } of entries) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "SuiteAnalyticsClickHouseRepository.upsertBatch",
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
        "Failed to batch upsert suite_analytics rows into ClickHouse",
      );
      throw error;
    }
  }
}
