import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { AnalyticsEvaluationFactData } from "../types";
import type { AnalyticsEvaluationFactsRepository } from "./analytics-evaluation-facts.repository";

const TABLE_NAME = "analytics_evaluation_facts" as const;

const logger = createLogger(
  "langwatch:app-layer:analytics:evaluation-facts-repository",
);

type ClickHouseEvaluationFactWriteRecord = WithDateWrites<
  ClickHouseEvaluationFactRecord,
  "OccurredAt" | "CreatedAt" | "UpdatedAt"
>;

interface ClickHouseEvaluationFactRecord {
  TenantId: string;
  EvaluationId: string;
  TraceId: string | null;
  OccurredAt: number;
  EvaluatorId: string;
  EvaluatorName: string | null;
  EvaluatorType: string;
  IsGuardrail: number;
  Score: number | null;
  Passed: number | null;
  Label: string | null;
  Status: string;
  UserId: string | null;
  ThreadId: string | null;
  TopicId: string | null;
  CustomerId: string | null;
  CreatedAt: number;
  UpdatedAt: number;
}

export class AnalyticsEvaluationFactsClickHouseRepository
  implements AnalyticsEvaluationFactsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsert(
    data: AnalyticsEvaluationFactData,
    tenantId: string,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId },
      "AnalyticsEvaluationFactsClickHouseRepository.upsert",
    );

    try {
      const client = await this.resolveClient(tenantId);
      const record = this.toClickHouseRecord(data, tenantId);

      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, evaluationId: data.evaluationId, error: errorMessage },
        "Failed to store analytics evaluation fact in ClickHouse",
      );
      throw error;
    }
  }

  async getByEvaluationId(
    tenantId: string,
    evaluationId: string,
  ): Promise<AnalyticsEvaluationFactData | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "AnalyticsEvaluationFactsClickHouseRepository.getByEvaluationId",
    );

    try {
      const client = await this.resolveClient(tenantId);
      const result = await client.query({
        query: `
          SELECT
            TenantId,
            EvaluationId,
            TraceId,
            toUnixTimestamp64Milli(OccurredAt) AS OccurredAt,
            EvaluatorId,
            EvaluatorName,
            EvaluatorType,
            IsGuardrail,
            Score,
            Passed,
            Label,
            Status,
            UserId,
            ThreadId,
            TopicId,
            CustomerId,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND EvaluationId = {evaluationId:String}
          ORDER BY UpdatedAt DESC
          LIMIT 1
        `,
        query_params: { tenantId, evaluationId },
        format: "JSONEachRow",
        clickhouse_settings: { select_sequential_consistency: "1" },
      });

      const rows = await result.json<ClickHouseEvaluationFactRecord>();
      const row = rows[0];
      if (!row) return null;

      return this.fromClickHouseRecord(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, evaluationId, error: errorMessage },
        "Failed to get analytics evaluation fact from ClickHouse",
      );
      throw error;
    }
  }

  private fromClickHouseRecord(
    record: ClickHouseEvaluationFactRecord,
  ): AnalyticsEvaluationFactData {
    return {
      evaluationId: record.EvaluationId,
      traceId: record.TraceId,
      occurredAt: record.OccurredAt,
      evaluatorId: record.EvaluatorId,
      evaluatorName: record.EvaluatorName,
      evaluatorType: record.EvaluatorType,
      isGuardrail: !!record.IsGuardrail,
      score: record.Score,
      passed: record.Passed != null ? !!record.Passed : null,
      label: record.Label,
      status: record.Status,
      userId: record.UserId,
      threadId: record.ThreadId,
      topicId: record.TopicId,
      customerId: record.CustomerId,
      createdAt: record.CreatedAt,
      updatedAt: record.UpdatedAt,
    };
  }

  private toClickHouseRecord(
    data: AnalyticsEvaluationFactData,
    tenantId: string,
  ): ClickHouseEvaluationFactWriteRecord {
    return {
      TenantId: tenantId,
      EvaluationId: data.evaluationId,
      TraceId: data.traceId,
      OccurredAt: new Date(data.occurredAt),
      EvaluatorId: data.evaluatorId,
      EvaluatorName: data.evaluatorName,
      EvaluatorType: data.evaluatorType,
      IsGuardrail: data.isGuardrail ? 1 : 0,
      Score: data.score,
      Passed: data.passed != null ? (data.passed ? 1 : 0) : null,
      Label: data.label,
      Status: data.status,
      UserId: data.userId,
      ThreadId: data.threadId,
      TopicId: data.topicId,
      CustomerId: data.customerId,
      CreatedAt: new Date(data.createdAt),
      UpdatedAt: new Date(data.updatedAt),
    };
  }
}
