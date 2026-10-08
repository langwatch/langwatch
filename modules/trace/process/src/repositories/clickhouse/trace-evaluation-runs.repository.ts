/**
 * Evaluation's `evaluation_runs`, shared with trace for reading (R40, EF-5): each
 * read collapses a run to its latest version, as evaluation's own reads collapse it.
 */
import {
  evaluationRunDataSchema,
  evaluationSummarySchema,
  traceEvaluationDataSchema,
  type EvaluationRunData,
  type EvaluationSummary,
  type TraceEvaluationData,
} from "@langwatch/evaluation-contract";
import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { TraceEvaluationRunsReadRepository } from "../trace-evaluation-runs.repository.ts";
import type { TraceClickHouseResolver } from "./clickhouse.trace-member-client.repository.ts";
import { chNumber, chString } from "./stored-span-row.mapper.ts";

const EVALUATION_RUNS_TABLE = "evaluation_runs" as const;
const RUNS = "runs" as const;
const TRACE_EVALUATION_COLUMNS_LIGHT = [
  "EvaluationId",
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
  `toUnixTimestamp64Milli(${RUNS}.ScheduledAt) AS ScheduledAt`,
  `toUnixTimestamp64Milli(${RUNS}.StartedAt) AS StartedAt`,
  `toUnixTimestamp64Milli(${RUNS}.CompletedAt) AS CompletedAt`,
].join(", ");
const TRACE_EVALUATION_COLUMNS_WITH_INPUTS = `${TRACE_EVALUATION_COLUMNS_LIGHT}, Inputs`;
const logger = createLogger("langwatch:trace:clickhouse.trace-evaluation-runs");

const chFlag = z.union([z.boolean(), z.number(), z.string()]);
const nullableString = z.string().nullable();
const nullableNumber = chNumber.nullable();

const summaryRowSchema = z.looseObject({
  EvaluationId: chString,
  EvaluatorId: chString,
  EvaluatorType: chString,
  EvaluatorName: nullableString,
  TraceId: nullableString,
  IsGuardrail: chFlag,
  Status: z.string(),
  Score: nullableNumber,
  Passed: chFlag.nullable(),
  Label: nullableString,
});

const traceEvaluationRowSchema = summaryRowSchema.safeExtend({
  Details: nullableString,
  Error: nullableString,
  Inputs: nullableString.optional(),
  ScheduledAt: nullableNumber,
  StartedAt: nullableNumber,
  CompletedAt: nullableNumber,
});

const runRowSchema = traceEvaluationRowSchema.safeExtend({
  Inputs: nullableString,
  ErrorDetails: nullableString,
  CreatedAt: chNumber,
  UpdatedAt: chNumber,
  ArchivedAt: nullableNumber,
  CostId: nullableString,
  LastEventOccurredAt: nullableNumber.optional(),
});

const summaryRowsSchema = z.array(summaryRowSchema);
const traceEvaluationRowsSchema = z.array(traceEvaluationRowSchema);
const runRowsSchema = z.array(runRowSchema);

type SummaryRow = z.infer<typeof summaryRowSchema>;

function isSet(flag: SummaryRow["IsGuardrail"]): boolean {
  return flag === true || flag === 1 || flag === "1" || flag === "true";
}

function isMemoryLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /memory limit\s*(exceeded|.*exceeded)/i.test(message);
}

function parseObject(value: string | null | undefined): Record<string, unknown> | null {
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

function summaryFields(row: SummaryRow) {
  return {
    evaluationId: row.EvaluationId,
    evaluatorId: row.EvaluatorId,
    evaluatorType: row.EvaluatorType,
    evaluatorName: row.EvaluatorName,
    traceId: row.TraceId,
    isGuardrail: isSet(row.IsGuardrail),
    status: row.Status,
    score: row.Score,
    passed: row.Passed === null ? null : isSet(row.Passed),
    label: row.Label,
  };
}

export class ClickHouseTraceEvaluationRunsRepository extends TraceEvaluationRunsReadRepository {
  static create(options: {
    resolveClient: TraceClickHouseResolver;
  }): ClickHouseTraceEvaluationRunsRepository {
    return new ClickHouseTraceEvaluationRunsRepository(options.resolveClient);
  }

  private constructor(private readonly resolveClient: TraceClickHouseResolver) {
    super();
  }

  async findRunsByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    EventUtils.validateTenantId(input, "ClickHouseTraceEvaluationRunsRepository.findRunsByTraceId");
    try {
      const client = await this.resolveClient(input.tenantId);
      const result = await client.query({
        query: `
          SELECT EvaluationId, EvaluatorId, EvaluatorType, EvaluatorName, TraceId,
            IsGuardrail, Status, Score, Passed, Label, Details, Inputs, Error, ErrorDetails,
            toUnixTimestamp64Milli(${RUNS}.CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(${RUNS}.UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(${RUNS}.ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(${RUNS}.ScheduledAt) AS ScheduledAt,
            toUnixTimestamp64Milli(${RUNS}.StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(${RUNS}.CompletedAt) AS CompletedAt, CostId,
            toUnixTimestamp64Milli(${RUNS}.LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${EVALUATION_RUNS_TABLE} AS ${RUNS}
          WHERE ${RUNS}.TenantId = {tenantId:String}
            AND ${RUNS}.ScheduledAt >= now() - INTERVAL 7 DAY
            AND ${RUNS}.TraceId = {traceId:String}
            AND (${RUNS}.TenantId, ${RUNS}.EvaluationId, ${RUNS}.UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${EVALUATION_RUNS_TABLE}
              WHERE TenantId = {tenantId:String}
                AND ScheduledAt >= now() - INTERVAL 7 DAY
                AND TraceId = {traceId:String}
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY ${RUNS}.UpdatedAt DESC
        `,
        query_params: { tenantId: input.tenantId, traceId: input.traceId },
        format: "JSONEachRow",
      });
      return runRowsSchema.parse(await result.json()).map((row) =>
        evaluationRunDataSchema.parse({
          ...summaryFields(row),
          details: row.Details,
          inputs: row.Inputs ? (JSON.parse(row.Inputs) as Record<string, unknown>) : null,
          error: row.Error,
          errorDetails: row.ErrorDetails,
          createdAt: row.CreatedAt,
          updatedAt: row.UpdatedAt,
          LastEventOccurredAt: row.LastEventOccurredAt ?? 0,
          archivedAt: row.ArchivedAt,
          scheduledAt: row.ScheduledAt,
          startedAt: row.StartedAt,
          completedAt: row.CompletedAt,
          costId: row.CostId,
        }),
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
    traceIds: readonly string[];
    since: number;
  }): Promise<Record<string, EvaluationSummary[]>> {
    if (input.traceIds.length === 0) return {};
    EventUtils.validateTenantId(
      input,
      "ClickHouseTraceEvaluationRunsRepository.findSummariesByTraceIds",
    );
    try {
      const client = await this.resolveClient(input.tenantId);
      const result = await client.query({
        query: `
          SELECT EvaluationId, EvaluatorId, EvaluatorType, EvaluatorName,
            TraceId, IsGuardrail, Status, Score, Passed, Label
          FROM ${EVALUATION_RUNS_TABLE}
          WHERE TenantId = {tenantId:String}
            AND ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})
            AND TraceId IN ({traceIds:Array(String)})
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${EVALUATION_RUNS_TABLE}
              WHERE TenantId = {tenantId:String}
                AND ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY UpdatedAt DESC
        `,
        query_params: {
          tenantId: input.tenantId,
          traceIds: [...input.traceIds],
          since: input.since,
        },
        format: "JSONEachRow",
      });
      const output: Record<string, EvaluationSummary[]> = {};
      for (const row of summaryRowsSchema.parse(await result.json())) {
        if (!row.TraceId) continue;
        (output[row.TraceId] ??= []).push(evaluationSummarySchema.parse(summaryFields(row)));
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
    traceIds: readonly string[];
  }): Promise<Record<string, TraceEvaluationData[]>> {
    if (input.traceIds.length === 0) return {};
    EventUtils.validateTenantId(
      input,
      "ClickHouseTraceEvaluationRunsRepository.findTraceEvaluations",
    );
    try {
      return await this.queryTraceEvaluations({
        ...input,
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
      return this.queryTraceEvaluations({ ...input, columns: TRACE_EVALUATION_COLUMNS_LIGHT });
    }
  }

  private async queryTraceEvaluations(input: {
    tenantId: string;
    traceIds: readonly string[];
    columns: string;
  }): Promise<Record<string, TraceEvaluationData[]>> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT ${input.columns}
        FROM ${EVALUATION_RUNS_TABLE} AS ${RUNS}
        WHERE ${RUNS}.TenantId = {tenantId:String}
          AND ${RUNS}.TraceId IN ({traceIds:Array(String)})
          AND (${RUNS}.TenantId, ${RUNS}.EvaluationId, ${RUNS}.UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM ${EVALUATION_RUNS_TABLE}
            WHERE TenantId = {tenantId:String}
              AND TraceId IN ({traceIds:Array(String)})
            GROUP BY TenantId, EvaluationId
          )
      `,
      query_params: { tenantId: input.tenantId, traceIds: [...input.traceIds] },
      format: "JSONEachRow",
    });
    const output = Object.fromEntries(
      input.traceIds.map((traceId) => [traceId, [] as TraceEvaluationData[]]),
    );
    for (const row of traceEvaluationRowsSchema.parse(await result.json())) {
      if (!row.TraceId) continue;
      const evaluation = traceEvaluationDataSchema.parse({
        ...summaryFields(row),
        details: row.Details,
        error: row.Error,
        ...(row.Inputs === undefined ? {} : { inputs: parseObject(row.Inputs) }),
        timestamps: {
          scheduledAt: row.ScheduledAt,
          startedAt: row.StartedAt,
          completedAt: row.CompletedAt,
        },
      });
      (output[row.TraceId] ??= []).push(evaluation);
    }
    return output;
  }
}
