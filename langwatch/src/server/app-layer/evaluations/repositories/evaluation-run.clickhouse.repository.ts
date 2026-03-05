import type { ClickHouseClient } from "@clickhouse/client";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { EVALUATION_PROJECTION_VERSIONS } from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/constants";
import { IdUtils } from "~/server/event-sourcing/pipelines/evaluation-processing/utils/id.utils";
import { createLogger } from "~/utils/logger/server";
import type { EvaluationRunData } from "../types";
import type { EvaluationRunRepository } from "./evaluation-run.repository";

const TABLE_NAME = "evaluation_runs" as const;

const logger = createLogger(
  "langwatch:app-layer:evaluations:evaluation-run-repository",
);

interface ClickHouseEvaluationRunRecord {
  ProjectionId: string;
  TenantId: string;
  EvaluationId: string;
  Version: string;
  EvaluatorId: string;
  EvaluatorType: string;
  EvaluatorName: string | null;
  TraceId: string | null;
  IsGuardrail: number;
  Status: string;
  Score: number | null;
  Passed: number | null;
  Label: string | null;
  Details: string | null;
  Error: string | null;
  ScheduledAt: number | null;
  StartedAt: number | null;
  CompletedAt: number | null;
  CostId: string | null;
  LastProcessedEventId: string;
}

type ClickHouseEvaluationRunWriteRecord = WithDateWrites<
  ClickHouseEvaluationRunRecord,
  "ScheduledAt" | "StartedAt" | "CompletedAt"
>;

export class EvaluationRunClickHouseRepository
  implements EvaluationRunRepository
{
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async upsert(data: EvaluationRunData, tenantId: string): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId },
      "EvaluationRunClickHouseRepository.upsert",
    );

    const projectionId = data.scheduledAt
      ? IdUtils.generateDeterministicEvaluationRunId(
          tenantId,
          data.evaluationId,
          data.scheduledAt,
        )
      : data.evaluationId;

    try {
      const record = this.toClickHouseRecord(
        data,
        tenantId,
        projectionId,
        EVALUATION_PROJECTION_VERSIONS.STATE,
      );

      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });

      logger.debug(
        { tenantId, evaluationId: data.evaluationId, projectionId },
        "Stored evaluation run to ClickHouse",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, evaluationId: data.evaluationId, error: errorMessage },
        "Failed to store evaluation run in ClickHouse",
      );
      throw error;
    }
  }

  async getByEvaluationId(
    tenantId: string,
    evaluationId: string,
  ): Promise<EvaluationRunData | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "EvaluationRunClickHouseRepository.getByEvaluationId",
    );

    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            ProjectionId,
            TenantId,
            EvaluationId,
            Version,
            EvaluatorId,
            EvaluatorType,
            EvaluatorName,
            TraceId,
            IsGuardrail,
            Status,
            Score,
            Passed,
            Label,
            Details,
            Error,
            toUnixTimestamp64Milli(ScheduledAt) AS ScheduledAt,
            toUnixTimestamp64Milli(StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(CompletedAt) AS CompletedAt,
            CostId,
            LastProcessedEventId
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND EvaluationId = {evaluationId:String}
          ORDER BY UpdatedAt DESC
          LIMIT 1
        `,
        query_params: { tenantId, evaluationId },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseEvaluationRunRecord>();
      const row = rows[0];
      if (!row) return null;

      return this.fromClickHouseRecord(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, evaluationId, error: errorMessage },
        "Failed to get evaluation run from ClickHouse",
      );
      throw error;
    }
  }

  private fromClickHouseRecord(
    record: ClickHouseEvaluationRunRecord,
  ): EvaluationRunData {
    return {
      evaluationId: record.EvaluationId,
      evaluatorId: record.EvaluatorId,
      evaluatorType: record.EvaluatorType,
      evaluatorName: record.EvaluatorName,
      traceId: record.TraceId,
      isGuardrail: record.IsGuardrail === 1,
      status: record.Status as EvaluationRunData["status"],
      score: record.Score,
      passed: record.Passed === null ? null : record.Passed === 1,
      label: record.Label,
      details: record.Details,
      error: record.Error,
      scheduledAt:
        record.ScheduledAt === null ? null : Number(record.ScheduledAt),
      startedAt: record.StartedAt === null ? null : Number(record.StartedAt),
      completedAt:
        record.CompletedAt === null ? null : Number(record.CompletedAt),
      costId: record.CostId ?? null,
    };
  }

  private toClickHouseRecord(
    data: EvaluationRunData,
    tenantId: string,
    projectionId: string,
    version: string,
  ): ClickHouseEvaluationRunWriteRecord {
    return {
      ProjectionId: projectionId,
      TenantId: tenantId,
      EvaluationId: data.evaluationId,
      Version: version,
      EvaluatorId: data.evaluatorId,
      EvaluatorType: data.evaluatorType,
      EvaluatorName: data.evaluatorName,
      TraceId: data.traceId,
      IsGuardrail: data.isGuardrail ? 1 : 0,
      Status: data.status,
      Score: data.score,
      Passed: data.passed === null ? null : data.passed ? 1 : 0,
      Label: data.label,
      Details: data.details,
      Error: data.error,
      ScheduledAt: data.scheduledAt != null ? new Date(data.scheduledAt) : null,
      StartedAt: data.startedAt != null ? new Date(data.startedAt) : null,
      CompletedAt: data.completedAt != null ? new Date(data.completedAt) : null,
      CostId: data.costId ?? null,
      LastProcessedEventId: projectionId,
    };
  }
}
