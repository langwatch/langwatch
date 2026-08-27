import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  evaluationRunDataSchema,
  evaluationSummarySchema,
  traceEvaluationDataSchema,
  type EvaluationRunData,
  type EvaluationRunLookup,
  type EvaluationSummary,
  type TraceEvaluationData,
} from "@langwatch/evaluation-contract";
import type {
  EvaluationClickHouseClient,
  EvaluationClickHouseResolver,
  EvaluationRetentionFloorPort,
} from "../../ports/evaluation.port";
import type { ClickHouseEvaluationRunRecord } from "./evaluation-run-write.repository";

const TABLE_NAME = "evaluation_runs" as const;
const RESOLVER_RECENT_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;
const DEFAULT_SCHEDULED_AT_SLACK_MS = 7 * 24 * 60 * 60 * 1000;
const TRACE_EVALUATION_COLUMNS_LIGHT = [
  "ProjectionId",
  "TenantId",
  "EvaluationId",
  "Version",
  "EvaluatorId",
  "EvaluatorType",
  "EvaluatorName",
  "TraceId",
  "IsGuardrail",
  "Status",
  "Score",
  "Passed",
  "Label",
  "Details",
  "Error",
  "ScheduledAt",
  "StartedAt",
  "CompletedAt",
  "LastProcessedEventId",
  "UpdatedAt",
].join(", ");
const TRACE_EVALUATION_COLUMNS_WITH_INPUTS = `${TRACE_EVALUATION_COLUMNS_LIGHT}, Inputs`;
const logger = createLogger("langwatch:evaluation:clickhouse.evaluation-run-read");

function validateTenant(tenantId: string, operation: string): void {
  EventUtils.validateTenantId({ tenantId }, operation);
}

function numberOrNull(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function isMemoryLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /memory limit\s*(exceeded|.*exceeded)/i.test(message);
}

function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Owns evaluation_runs reads, bounded lookup windows, and row decoding. */
export class EvaluationRunClickHouseReadRepository {
  static create(options: {
    resolveClient: EvaluationClickHouseResolver;
    retentionFloor: EvaluationRetentionFloorPort;
  }): EvaluationRunClickHouseReadRepository {
    return new EvaluationRunClickHouseReadRepository(options);
  }

  private constructor(
    private readonly options: {
      resolveClient: EvaluationClickHouseResolver;
      retentionFloor: EvaluationRetentionFloorPort;
    },
  ) {}

  async tryFindByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null> {
    validateTenant(input.tenantId, "EvaluationRunClickHouseReadRepository.tryFindByEvaluationId");
    try {
      const { scheduledAtFrom, scheduledAtTo } = await this.resolveScheduledAtRange(input);
      const bounds = (column: string): string =>
        `AND ${column} >= fromUnixTimestamp64Milli({scheduledAtFrom:Int64})` +
        (scheduledAtTo === undefined
          ? ""
          : ` AND ${column} <= fromUnixTimestamp64Milli({scheduledAtTo:Int64})`);
      const client = await this.options.resolveClient(input.tenantId);
      const result = await client.query({
        query: `
          SELECT
            t.ProjectionId AS ProjectionId, t.TenantId AS TenantId,
            t.EvaluationId AS EvaluationId, t.Version AS Version,
            t.EvaluatorId AS EvaluatorId, t.EvaluatorType AS EvaluatorType,
            t.EvaluatorName AS EvaluatorName, t.TraceId AS TraceId,
            t.IsGuardrail AS IsGuardrail, t.Status AS Status, t.Score AS Score,
            t.Passed AS Passed, t.Label AS Label, t.Details AS Details,
            t.Inputs AS Inputs, t.Error AS Error, t.ErrorDetails AS ErrorDetails,
            toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(t.ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(t.ScheduledAt) AS ScheduledAt,
            toUnixTimestamp64Milli(t.StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(t.CompletedAt) AS CompletedAt,
            t.CostId AS CostId, t.LastProcessedEventId AS LastProcessedEventId,
            toUnixTimestamp64Milli(t.LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME} AS t
          PREWHERE (t.TenantId, t.EvaluationId, t.UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND EvaluationId = {evaluationId:String}
              ${bounds("ScheduledAt")}
            GROUP BY TenantId, EvaluationId
          )
          WHERE t.TenantId = {tenantId:String}
            AND t.EvaluationId = {evaluationId:String}
            ${bounds("t.ScheduledAt")}
          LIMIT 1
        `,
        query_params: {
          tenantId: input.tenantId,
          evaluationId: input.evaluationId,
          scheduledAtFrom,
          ...(scheduledAtTo === undefined ? {} : { scheduledAtTo }),
        },
        format: "JSONEachRow",
      });
      const row = (await result.json<ClickHouseEvaluationRunRecord>())[0];
      return row ? this.fromClickHouseRecord(row) : null;
    } catch (error) {
      logger.warn(
        { tenantId: input.tenantId, evaluationId: input.evaluationId, error },
        "Failed to get evaluation run from ClickHouse",
      );
      throw error;
    }
  }

  async findByTraceId(input: { tenantId: string; traceId: string }): Promise<EvaluationRunData[]> {
    validateTenant(input.tenantId, "EvaluationRunClickHouseReadRepository.findByTraceId");
    try {
      const client = await this.options.resolveClient(input.tenantId);
      const result = await client.query({
        query: `
          SELECT ProjectionId, TenantId, EvaluationId, Version, EvaluatorId,
            EvaluatorType, EvaluatorName, TraceId, IsGuardrail, Status, Score,
            Passed, Label, Details, Inputs, Error, ErrorDetails,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(ScheduledAt) AS ScheduledAt,
            toUnixTimestamp64Milli(StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(CompletedAt) AS CompletedAt, CostId,
            LastProcessedEventId,
            toUnixTimestamp64Milli(LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND ScheduledAt >= now() - INTERVAL 7 DAY
            AND TraceId = {traceId:String}
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND ScheduledAt >= now() - INTERVAL 7 DAY
                AND TraceId = {traceId:String}
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY UpdatedAt DESC
        `,
        query_params: { tenantId: input.tenantId, traceId: input.traceId },
        format: "JSONEachRow",
      });
      return (await result.json<ClickHouseEvaluationRunRecord>()).map((row) =>
        this.fromClickHouseRecord(row),
      );
    } catch (error) {
      logger.warn(
        { tenantId: input.tenantId, traceId: input.traceId, error },
        "Failed to find evaluation runs by trace ID in ClickHouse",
      );
      throw error;
    }
  }

  async findSummariesByTraceIds(input: {
    tenantId: string;
    traceIds: string[];
    since: number;
  }): Promise<Record<string, EvaluationSummary[]>> {
    if (input.traceIds.length === 0) return {};
    validateTenant(input.tenantId, "EvaluationRunClickHouseReadRepository.findSummariesByTraceIds");
    try {
      const client = await this.options.resolveClient(input.tenantId);
      const result = await client.query({
        query: `
          SELECT EvaluationId, EvaluatorId, EvaluatorType, EvaluatorName,
            TraceId, IsGuardrail, Status, Score, Passed, Label
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})
            AND TraceId IN ({traceIds:Array(String)})
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY UpdatedAt DESC
        `,
        query_params: {
          tenantId: input.tenantId,
          traceIds: input.traceIds,
          since: input.since,
        },
        format: "JSONEachRow",
      });
      const output: Record<string, EvaluationSummary[]> = {};
      for (const row of await result.json<ClickHouseEvaluationRunRecord>()) {
        if (!row.TraceId) continue;
        const summary = evaluationSummarySchema.parse({
          evaluationId: row.EvaluationId,
          evaluatorId: row.EvaluatorId,
          evaluatorType: row.EvaluatorType,
          evaluatorName: row.EvaluatorName,
          traceId: row.TraceId,
          isGuardrail: Boolean(row.IsGuardrail),
          status: row.Status,
          score: row.Score,
          passed: row.Passed === null ? null : Boolean(row.Passed),
          label: row.Label,
        });
        (output[row.TraceId] ??= []).push(summary);
      }
      return output;
    } catch (error) {
      logger.warn(
        { tenantId: input.tenantId, traceIdCount: input.traceIds.length, error },
        "Failed to find evaluation summaries by trace IDs in ClickHouse",
      );
      throw error;
    }
  }

  async findTraceEvaluations(input: {
    tenantId: string;
    traceIds: string[];
  }): Promise<Record<string, TraceEvaluationData[]>> {
    if (input.traceIds.length === 0) return {};
    validateTenant(input.tenantId, "EvaluationRunClickHouseReadRepository.findTraceEvaluations");
    const client = await this.options.resolveClient(input.tenantId);
    try {
      return await this.queryTraceEvaluations({
        client,
        tenantId: input.tenantId,
        traceIds: input.traceIds,
        columns: TRACE_EVALUATION_COLUMNS_WITH_INPUTS,
      });
    } catch (error) {
      if (!isMemoryLimitError(error)) {
        logger.error(
          { tenantId: input.tenantId, traceIdCount: input.traceIds.length, error },
          "Failed to fetch trace evaluations from ClickHouse",
        );
        throw error;
      }
      logger.warn(
        { tenantId: input.tenantId, traceIdCount: input.traceIds.length },
        "Trace evaluation read hit the ClickHouse memory limit; retrying without inputs",
      );
      return this.queryTraceEvaluations({
        client,
        tenantId: input.tenantId,
        traceIds: input.traceIds,
        columns: TRACE_EVALUATION_COLUMNS_LIGHT,
      });
    }
  }

  async tryFindInputs(input: {
    tenantId: string;
    evaluationId: string;
  }): Promise<Record<string, unknown> | null> {
    validateTenant(input.tenantId, "EvaluationRunClickHouseReadRepository.tryFindInputs");
    let client: EvaluationClickHouseClient;
    try {
      client = await this.options.resolveClient(input.tenantId);
    } catch (error) {
      logger.warn(
        { tenantId: input.tenantId, evaluationId: input.evaluationId, error },
        "ClickHouse client unavailable for evaluation inputs",
      );
      return null;
    }
    try {
      const result = await client.query({
        query: `
          SELECT argMax(Inputs, UpdatedAt) AS Inputs
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND EvaluationId = {evaluationId:String}
        `,
        query_params: input,
        format: "JSONEachRow",
      });
      const row = (await result.json<{ Inputs: string | null }>())[0];
      return parseObject(row?.Inputs ?? null);
    } catch (error) {
      if (isMemoryLimitError(error)) {
        logger.warn(
          { tenantId: input.tenantId, evaluationId: input.evaluationId },
          "Evaluation inputs read hit the ClickHouse memory limit",
        );
        return null;
      }
      logger.warn(
        { tenantId: input.tenantId, evaluationId: input.evaluationId, error },
        "Failed to fetch evaluation inputs from ClickHouse",
      );
      throw error;
    }
  }

  private async queryTraceEvaluations(input: {
    client: EvaluationClickHouseClient;
    tenantId: string;
    traceIds: string[];
    columns: string;
  }): Promise<Record<string, TraceEvaluationData[]>> {
    const result = await input.client.query({
      query: `
        SELECT ${input.columns}
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND TraceId IN ({traceIds:Array(String)})
          AND (TenantId, EvaluationId, UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId IN ({traceIds:Array(String)})
            GROUP BY TenantId, EvaluationId
          )
      `,
      query_params: { tenantId: input.tenantId, traceIds: input.traceIds },
      format: "JSONEachRow",
    });
    const output = Object.fromEntries(
      input.traceIds.map((traceId) => [traceId, [] as TraceEvaluationData[]]),
    );
    for (const row of await result.json<ClickHouseEvaluationRunRecord>()) {
      if (!row.TraceId) continue;
      const traceEvaluation = traceEvaluationDataSchema.parse({
        evaluationId: row.EvaluationId,
        evaluatorId: row.EvaluatorId,
        evaluatorType: row.EvaluatorType,
        evaluatorName: row.EvaluatorName,
        traceId: row.TraceId,
        isGuardrail: Boolean(row.IsGuardrail),
        status: row.Status,
        score: row.Score,
        passed: row.Passed === null ? null : Boolean(row.Passed),
        label: row.Label,
        details: row.Details,
        error: row.Error,
        ...(Object.prototype.hasOwnProperty.call(row, "Inputs")
          ? { inputs: parseObject(row.Inputs) }
          : {}),
        timestamps: {
          scheduledAt: numberOrNull(row.ScheduledAt),
          startedAt: numberOrNull(row.StartedAt),
          completedAt: numberOrNull(row.CompletedAt),
        },
      });
      (output[row.TraceId] ??= []).push(traceEvaluation);
    }
    return output;
  }

  private async resolveScheduledAtRange(input: EvaluationRunLookup): Promise<{
    scheduledAtFrom: number;
    scheduledAtTo?: number;
  }> {
    const slackMs = input.scheduledAtSlackMs ?? DEFAULT_SCHEDULED_AT_SLACK_MS;
    if (input.scheduledAt) {
      return {
        scheduledAtFrom: input.scheduledAt.getTime() - slackMs,
        scheduledAtTo: input.scheduledAt.getTime() + slackMs,
      };
    }

    const floorMs = await this.options.retentionFloor.getFloorMs({
      table: TABLE_NAME,
      tenantId: input.tenantId,
    });
    const recent = await this.queryScheduledAtMs({
      tenantId: input.tenantId,
      evaluationId: input.evaluationId,
      sinceMs: Date.now() - RESOLVER_RECENT_WINDOW_MS,
    });
    if (recent !== undefined) {
      return { scheduledAtFrom: recent - slackMs, scheduledAtTo: recent + slackMs };
    }
    const fallback = await this.queryScheduledAtMs({
      tenantId: input.tenantId,
      evaluationId: input.evaluationId,
      sinceMs: floorMs,
    });
    return fallback === undefined
      ? { scheduledAtFrom: floorMs }
      : { scheduledAtFrom: fallback - slackMs, scheduledAtTo: fallback + slackMs };
  }

  private async queryScheduledAtMs(input: {
    tenantId: string;
    evaluationId: string;
    sinceMs: number;
  }): Promise<number | undefined> {
    const client = await this.options.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT toUnixTimestamp64Milli(argMax(ScheduledAt, UpdatedAt)) AS scheduledAtMs
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND EvaluationId = {evaluationId:String}
          AND ScheduledAt >= fromUnixTimestamp64Milli({sinceMs:Int64})
      `,
      query_params: {
        tenantId: input.tenantId,
        evaluationId: input.evaluationId,
        sinceMs: input.sinceMs,
      },
      format: "JSONEachRow",
    });
    const raw = (await result.json<{ scheduledAtMs: number | string | null }>())[0]?.scheduledAtMs;
    if (raw === null || raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  private fromClickHouseRecord(row: ClickHouseEvaluationRunRecord): EvaluationRunData {
    return evaluationRunDataSchema.parse({
      evaluationId: row.EvaluationId,
      evaluatorId: row.EvaluatorId,
      evaluatorType: row.EvaluatorType,
      evaluatorName: row.EvaluatorName,
      traceId: row.TraceId,
      isGuardrail: Boolean(row.IsGuardrail),
      status: row.Status,
      score: row.Score,
      passed: row.Passed === null ? null : Boolean(row.Passed),
      label: row.Label,
      details: row.Details,
      inputs: row.Inputs ? (JSON.parse(row.Inputs) as Record<string, unknown>) : null,
      error: row.Error,
      errorDetails: row.ErrorDetails,
      createdAt: Number(row.CreatedAt),
      updatedAt: Number(row.UpdatedAt),
      LastEventOccurredAt: Number(row.LastEventOccurredAt ?? 0),
      archivedAt: numberOrNull(row.ArchivedAt),
      scheduledAt: numberOrNull(row.ScheduledAt),
      startedAt: numberOrNull(row.StartedAt),
      completedAt: numberOrNull(row.CompletedAt),
      costId: row.CostId,
    });
  }
}
