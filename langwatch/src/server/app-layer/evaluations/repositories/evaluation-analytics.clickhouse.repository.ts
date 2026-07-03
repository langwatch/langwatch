import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { BaseAnalyticsSlimClickHouseRepository } from "~/server/app-layer/analytics/repositories/analyticsWriteBase";
import type { EvaluationAnalyticsRow } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";
import type { EvaluationAnalyticsRepository } from "./evaluation-analytics.repository";

/**
 * ClickHouse write shape for the slim `evaluation_analytics` table
 * (ADR-034 Phase 6, migration 00040).
 *
 * The 64-bit-integer column (`DurationMs`) is serialised as a STRING in
 * the JSONEachRow body — JSON numbers can't safely round-trip values past
 * 2^53. Float64 / UInt32 / Bool columns stay as numbers / booleans.
 */
interface ClickHouseEvaluationAnalyticsWriteRecord {
  TenantId: string;
  EvaluationId: string;
  Version: string;
  OccurredAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;

  EvaluatorType: string;
  EvaluatorName: string | null;
  Status: string;
  IsGuardrail: boolean;
  Passed: boolean | null;
  Score: number | null;
  Label: string | null;
  Model: string | null;
  TraceId: string | null;
  UserId: string | null;
  ConversationId: string | null;
  CustomerId: string | null;
  Origin: string | null;

  // Int64 column — stringified for JSON precision.
  DurationMs: string;
  TotalCost: number | null;
  NonBilledCost: number | null;

  Attributes: Record<string, string>;

  _retention_days: number;
}

function toClickHouseRecord(
  row: EvaluationAnalyticsRow,
  retentionDays: number,
): ClickHouseEvaluationAnalyticsWriteRecord {
  return {
    TenantId: row.tenantId,
    EvaluationId: row.evaluationId,
    Version: row.version,
    OccurredAt: new Date(row.occurredAtMs),
    CreatedAt: new Date(row.createdAtMs),
    UpdatedAt: new Date(row.updatedAtMs),

    EvaluatorType: row.evaluatorType,
    EvaluatorName: row.evaluatorName,
    Status: row.status,
    IsGuardrail: row.isGuardrail,
    Passed: row.passed,
    Score: row.score,
    Label: row.label,
    Model: row.model,
    TraceId: row.traceId,
    UserId: row.userId,
    ConversationId: row.conversationId,
    CustomerId: row.customerId,
    Origin: row.origin,

    DurationMs: String(Math.round(row.durationMs)),
    TotalCost: row.totalCost,
    NonBilledCost: row.nonBilledCost,

    Attributes: row.attributes,

    _retention_days: retentionDays,
  };
}

export class EvaluationAnalyticsClickHouseRepository
  extends BaseAnalyticsSlimClickHouseRepository<
    EvaluationAnalyticsRow,
    ClickHouseEvaluationAnalyticsWriteRecord
  >
  implements EvaluationAnalyticsRepository
{
  constructor(resolveClient: ClickHouseClientResolver) {
    super(resolveClient, {
      tableName: "evaluation_analytics",
      loggerName:
        "langwatch:app-layer:evaluations:evaluation-analytics-repository",
      entityIdOf: (row) => ({ evaluationId: row.evaluationId }),
      toRecord: toClickHouseRecord,
    });
  }
}
