import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
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
  Inputs: string | null;
  Error: string | null;
  ErrorDetails: string | null;
  CreatedAt: number;
  UpdatedAt: number;
  ArchivedAt: number | null;
  ScheduledAt: number | null;
  StartedAt: number | null;
  CompletedAt: number | null;
  CostId: string | null;
  LastProcessedEventId: string;
}

type ClickHouseEvaluationRunWriteRecord = WithDateWrites<
  ClickHouseEvaluationRunRecord,
  "CreatedAt" | "UpdatedAt" | "ArchivedAt" | "ScheduledAt" | "StartedAt" | "CompletedAt"
>;

export class EvaluationRunClickHouseRepository
  implements EvaluationRunRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

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
      const client = await this.resolveClient(tenantId);
      const record = this.toClickHouseRecord(
        data,
        tenantId,
        projectionId,
        EVALUATION_PROJECTION_VERSIONS.STATE,
      );

      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });

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
      const client = await this.resolveClient(tenantId);
      const result = await client.query({
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
            Inputs,
            Error,
            ErrorDetails,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(ArchivedAt) AS ArchivedAt,
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
        clickhouse_settings: { select_sequential_consistency: "1" },
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
      isGuardrail: !!record.IsGuardrail,
      status: record.Status as EvaluationRunData["status"],
      score: record.Score,
      passed: record.Passed === null ? null : !!record.Passed,
      label: record.Label,
      details: record.Details,
      inputs: record.Inputs
        ? (JSON.parse(record.Inputs) as Record<string, unknown>)
        : null,
      error: record.Error,
      errorDetails: record.ErrorDetails,
      createdAt: Number(record.CreatedAt),
      updatedAt: Number(record.UpdatedAt),
      archivedAt: record.ArchivedAt === null ? null : Number(record.ArchivedAt),
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
      Inputs: data.inputs ? JSON.stringify(data.inputs) : null,
      Error: data.error,
      ErrorDetails: data.errorDetails,
      CreatedAt: new Date(data.createdAt),
      UpdatedAt: new Date(data.updatedAt),
      ArchivedAt: data.archivedAt != null ? new Date(data.archivedAt) : null,
      ScheduledAt: new Date(data.scheduledAt ?? data.createdAt),
      StartedAt: data.startedAt != null ? new Date(data.startedAt) : null,
      CompletedAt: data.completedAt != null ? new Date(data.completedAt) : null,
      CostId: data.costId ?? null,
      LastProcessedEventId: projectionId,
    };
  }
}
