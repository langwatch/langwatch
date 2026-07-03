import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { BaseAnalyticsSlimClickHouseRepository } from "~/server/app-layer/analytics/repositories/analyticsWriteBase";
import type { ExperimentAnalyticsRow } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentAnalytics.foldProjection";
import type { ExperimentAnalyticsRepository } from "./experiment-analytics.repository";

/**
 * ClickHouse write shape for the slim `experiment_analytics` table
 * (ADR-034 Phase 7, migration 00044).
 *
 * `TotalDurationMs` is Int64 — serialised as a STRING in JSONEachRow for the
 * same precision reason the trace + eval slim use. `TotalCost`, `AvgScoreBps`,
 * `PassRateBps` are Nullable; UInt32 counters fit in JSON numbers.
 */
interface ClickHouseExperimentAnalyticsWriteRecord {
  TenantId: string;
  RunId: string;
  Version: string;
  OccurredAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;

  ExperimentId: string;
  WorkflowVersionId: string | null;
  CompletionMode: string;

  Total: number;
  Progress: number;
  CompletedCount: number;
  FailedCount: number;
  TotalCost: number | null;
  TotalDurationMs: string | null;
  AvgScoreBps: number | null;
  PassRateBps: number | null;

  Attributes: Record<string, string>;

  _retention_days: number;
}

function toClickHouseRecord(
  row: ExperimentAnalyticsRow,
  retentionDays: number,
): ClickHouseExperimentAnalyticsWriteRecord {
  return {
    TenantId: row.tenantId,
    RunId: row.runId,
    Version: row.version,
    OccurredAt: new Date(row.occurredAtMs),
    CreatedAt: new Date(row.createdAtMs),
    UpdatedAt: new Date(row.updatedAtMs),

    ExperimentId: row.experimentId,
    WorkflowVersionId: row.workflowVersionId,
    CompletionMode: row.completionMode,

    Total: row.total,
    Progress: row.progress,
    CompletedCount: row.completedCount,
    FailedCount: row.failedCount,
    TotalCost: row.totalCost,
    TotalDurationMs:
      row.totalDurationMs == null
        ? null
        : String(Math.round(row.totalDurationMs)),
    AvgScoreBps: row.avgScoreBps,
    PassRateBps: row.passRateBps,

    Attributes: row.attributes,

    _retention_days: retentionDays,
  };
}

export class ExperimentAnalyticsClickHouseRepository
  extends BaseAnalyticsSlimClickHouseRepository<
    ExperimentAnalyticsRow,
    ClickHouseExperimentAnalyticsWriteRecord
  >
  implements ExperimentAnalyticsRepository
{
  constructor(resolveClient: ClickHouseClientResolver) {
    super(resolveClient, {
      tableName: "experiment_analytics",
      loggerName:
        "langwatch:app-layer:experiments:experiment-analytics-repository",
      entityIdOf: (row) => ({ runId: row.runId }),
      toRecord: toClickHouseRecord,
    });
  }
}
