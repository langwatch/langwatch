import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { EvaluationAnalyticsRow } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { EvaluationAnalyticsRepository } from "./evaluation-analytics.repository";

const TABLE_NAME = "evaluation_analytics" as const;

const logger = createLogger(
  "langwatch:app-layer:evaluations:evaluation-analytics-repository",
);

/**
 * ClickHouse write shape for the slim `evaluation_analytics` table
 * (ADR-034 Phase 6, migration 00039).
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
  implements EvaluationAnalyticsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsert(
    row: EvaluationAnalyticsRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "EvaluationAnalyticsClickHouseRepository.upsert",
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
          evaluationId: row.evaluationId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to upsert evaluation_analytics row into ClickHouse",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{ row: EvaluationAnalyticsRow; retentionDays?: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.row.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "EvaluationAnalyticsClickHouseRepository.upsertBatch",
    );
    for (const { row } of entries) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "EvaluationAnalyticsClickHouseRepository.upsertBatch",
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
        "Failed to batch upsert evaluation_analytics rows into ClickHouse",
      );
      throw error;
    }
  }
}
