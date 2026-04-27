import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { EVALUATION_PROJECTION_VERSIONS } from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/constants";
import { IdUtils } from "~/server/event-sourcing/pipelines/evaluation-processing/utils/id.utils";
import { createLogger } from "~/utils/logger/server";
import type { EvalSummary, EvaluationRunData } from "../types";
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
  lastEventOccurredAt: number;
}

type ClickHouseEvaluationRunWriteRecord = WithDateWrites<
  ClickHouseEvaluationRunRecord,
  "CreatedAt" | "UpdatedAt" | "ArchivedAt" | "ScheduledAt" | "StartedAt" | "CompletedAt" | "lastEventOccurredAt"
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

  async upsertBatch(
    entries: Array<{ data: EvaluationRunData; tenantId: string }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "EvaluationRunClickHouseRepository.upsertBatch",
    );

    const mixedTenant = entries.find((e) => e.tenantId !== tenantId);
    if (mixedTenant) {
      throw new Error(
        `Mixed tenants in upsertBatch: expected ${tenantId}, got ${mixedTenant.tenantId}. ` +
        `Each batch must contain a single tenant to ensure correct DB routing.`,
      );
    }

    try {
      const client = await this.resolveClient(tenantId);
      const records = entries.map(({ data, tenantId: tid }) => {
        const projectionId = data.scheduledAt
          ? IdUtils.generateDeterministicEvaluationRunId(
              tid,
              data.evaluationId,
              data.scheduledAt,
            )
          : data.evaluationId;
        return this.toClickHouseRecord(
          data,
          tid,
          projectionId,
          EVALUATION_PROJECTION_VERSIONS.STATE,
        );
      });

      await client.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, count: entries.length, error: errorMessage },
        "Failed to batch store evaluation runs in ClickHouse",
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
      // IN-tuple dedup over the ReplacingMergeTree: the inner SELECT scans
      // only (TenantId, EvaluationId, UpdatedAt) — small, sparse — to find
      // the latest version, then the outer SELECT pulls the heavy columns
      // (Inputs, Details, Error, ErrorDetails — ZSTD(3)) for that one row.
      //
      // Do not "simplify" to `ORDER BY UpdatedAt DESC LIMIT 1`: with many
      // unmerged versions per (TenantId, EvaluationId) it forces the engine
      // to read every version *with* the heavy columns just to sort them in
      // memory.
      //
      // Outer SELECT references columns via the `t.` alias because the
      // SELECT projects `toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt`
      // (and similar for Created/Archived/Scheduled/Started/CompletedAt).
      // Without the alias the IN-tuple's `UpdatedAt` could resolve to the
      // projected UInt64 alias instead of the raw DateTime64 column and the
      // type comparison would break. See
      // dev/docs/best_practices/clickhouse-queries.md.
      const result = await client.query({
        query: `
          SELECT
            t.ProjectionId AS ProjectionId,
            t.TenantId AS TenantId,
            t.EvaluationId AS EvaluationId,
            t.Version AS Version,
            t.EvaluatorId AS EvaluatorId,
            t.EvaluatorType AS EvaluatorType,
            t.EvaluatorName AS EvaluatorName,
            t.TraceId AS TraceId,
            t.IsGuardrail AS IsGuardrail,
            t.Status AS Status,
            t.Score AS Score,
            t.Passed AS Passed,
            t.Label AS Label,
            t.Details AS Details,
            t.Inputs AS Inputs,
            t.Error AS Error,
            t.ErrorDetails AS ErrorDetails,
            toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(t.ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(t.ScheduledAt) AS ScheduledAt,
            toUnixTimestamp64Milli(t.StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(t.CompletedAt) AS CompletedAt,
            t.CostId AS CostId,
            t.LastProcessedEventId AS LastProcessedEventId
          FROM ${TABLE_NAME} AS t
          WHERE t.TenantId = {tenantId:String}
            AND t.EvaluationId = {evaluationId:String}
            AND (t.TenantId, t.EvaluationId, t.UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND EvaluationId = {evaluationId:String}
              GROUP BY TenantId, EvaluationId
            )
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

  async findByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<EvaluationRunData[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "EvaluationRunClickHouseRepository.findByTraceId",
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
            LastProcessedEventId,
            toUnixTimestamp64Milli(LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND ScheduledAt >= now() - INTERVAL 7 DAY
            AND TraceId = {traceId:String}
          ORDER BY UpdatedAt DESC
        `,
        query_params: { tenantId, traceId },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseEvaluationRunRecord>();

      // Deduplicate by EvaluationId (take latest UpdatedAt per evaluation)
      const seen = new Set<string>();
      const deduped: EvaluationRunData[] = [];
      for (const row of rows) {
        if (seen.has(row.EvaluationId)) continue;
        seen.add(row.EvaluationId);
        deduped.push(this.fromClickHouseRecord(row));
      }

      return deduped;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, traceId, error: errorMessage },
        "Failed to find evaluation runs by trace ID in ClickHouse",
      );
      throw error;
    }
  }

  async findSummariesByTraceIds(
    tenantId: string,
    traceIds: string[],
  ): Promise<Record<string, EvalSummary[]>> {
    if (traceIds.length === 0) return {};

    EventUtils.validateTenantId(
      { tenantId },
      "EvaluationRunClickHouseRepository.findSummariesByTraceIds",
    );

    try {
      const client = await this.resolveClient(tenantId);
      const result = await client.query({
        query: `
          SELECT
            EvaluationId,
            EvaluatorId,
            EvaluatorType,
            EvaluatorName,
            TraceId,
            IsGuardrail,
            Status,
            Score,
            Passed,
            Label
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND ScheduledAt >= now() - INTERVAL 7 DAY
            AND TraceId IN ({traceIds:Array(String)})
          ORDER BY UpdatedAt DESC
        `,
        query_params: { tenantId, traceIds },
        format: "JSONEachRow",
      });

      interface SlimRow {
        EvaluationId: string;
        EvaluatorId: string;
        EvaluatorType: string;
        EvaluatorName: string | null;
        TraceId: string | null;
        IsGuardrail: number;
        Status: string;
        Score: number | null;
        Passed: number | null;
        Label: string | null;
      }

      const rows = await result.json<SlimRow>();

      const byTrace: Record<string, EvalSummary[]> = {};
      const seen = new Set<string>();

      for (const row of rows) {
        if (seen.has(row.EvaluationId)) continue;
        seen.add(row.EvaluationId);

        const traceId = row.TraceId;
        if (!traceId) continue;

        const summary: EvalSummary = {
          evaluationId: row.EvaluationId,
          evaluatorId: row.EvaluatorId,
          evaluatorType: row.EvaluatorType,
          evaluatorName: row.EvaluatorName,
          traceId,
          isGuardrail: !!row.IsGuardrail,
          status: row.Status as EvalSummary["status"],
          score: row.Score,
          passed: row.Passed === null ? null : !!row.Passed,
          label: row.Label,
        };

        const arr = byTrace[traceId];
        if (arr) {
          arr.push(summary);
        } else {
          byTrace[traceId] = [summary];
        }
      }

      return byTrace;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, traceIdCount: traceIds.length, error: errorMessage },
        "Failed to find evaluation summaries by trace IDs in ClickHouse",
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
      lastEventOccurredAt: Number(record.lastEventOccurredAt ?? 0),
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
      lastEventOccurredAt: data.lastEventOccurredAt ? new Date(data.lastEventOccurredAt) : new Date(0),
      ArchivedAt: data.archivedAt != null ? new Date(data.archivedAt) : null,
      ScheduledAt: new Date(data.scheduledAt ?? data.createdAt),
      StartedAt: data.startedAt != null ? new Date(data.startedAt) : null,
      CompletedAt: data.completedAt != null ? new Date(data.completedAt) : null,
      CostId: data.costId ?? null,
      LastProcessedEventId: projectionId,
    };
  }
}
