import type { Authorization } from "@langwatch/authorization";
import { type AuthorizedClickHouse, tenantScope } from "@langwatch/clickhouse-client";
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
import type {
  TraceClickHouseClient,
  TraceClickHouseResolver,
} from "./clickhouse.trace-member-client.repository.ts";
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

const tenantSummaryRowsSchema = z.array(summaryRowSchema.safeExtend({ TenantId: chString }));
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
    clickhouse: AuthorizedClickHouse;
  }): ClickHouseTraceEvaluationRunsRepository {
    return new ClickHouseTraceEvaluationRunsRepository(options.resolveClient, options.clickhouse);
  }

  private constructor(
    private readonly resolveClient: TraceClickHouseResolver,
    private readonly clickhouse: AuthorizedClickHouse,
  ) {
    super();
  }

  async findRunsByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    EventUtils.validateTenantId(input, "ClickHouseTraceEvaluationRunsRepository.findRunsByTraceId");
    try {
      return await this.queryRuns({
        ...(await this.ownTenant(input.tenantId)),
        traceId: input.traceId,
      });
    } catch (error) {
      logger.warn(
        { tenantId: input.tenantId, traceId: input.traceId, error },
        "Failed to find evaluation runs by trace ID in ClickHouse",
      );
      throw error;
    }
  }

  /** The fence on `ScheduledAt` is the only tenant predicate, outer and in the dedup alike. */
  async findReadableRunsByTraceId(input: {
    authorization: Authorization;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    try {
      return await this.queryRuns({
        client: this.clickhouse.as(input.authorization, { reads: "traces" }),
        tenantPredicate: tenantScope("ScheduledAt"),
        dedupTenantPredicate: tenantScope("ScheduledAt"),
        params: {},
        traceId: input.traceId,
      });
    } catch (error) {
      logger.warn(
        { traceId: input.traceId, error },
        "Failed to find evaluation runs by trace ID through the proof in ClickHouse",
      );
      throw error;
    }
  }

  private async queryRuns(input: {
    client: TraceClickHouseClient;
    tenantPredicate: string;
    dedupTenantPredicate: string;
    params: Record<string, string>;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    const result = await input.client.query({
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
        WHERE ${input.tenantPredicate}
          AND ${RUNS}.ScheduledAt >= now() - INTERVAL 7 DAY
          AND ${RUNS}.TraceId = {traceId:String}
          AND (${RUNS}.TenantId, ${RUNS}.EvaluationId, ${RUNS}.UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM ${EVALUATION_RUNS_TABLE}
            WHERE ${input.dedupTenantPredicate}
              AND ScheduledAt >= now() - INTERVAL 7 DAY
              AND TraceId = {traceId:String}
            GROUP BY TenantId, EvaluationId
          )
        ORDER BY ${RUNS}.UpdatedAt DESC
      `,
      query_params: { ...input.params, traceId: input.traceId },
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
  }

  /**
   * The fence is the only tenant predicate, outer and in the dedup alike, on `ScheduledAt`, the
   * partition column; a shared grant's window bounds the run's own time, as `since` does.
   */
  async findSummariesByTraceIds(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    since: number;
  }): Promise<(EvaluationSummary & { tenantId: string })[]> {
    if (input.traceIds.length === 0) return [];
    try {
      const client = this.clickhouse.as(input.authorization, { reads: "traces" });
      const result = await client.query({
        query: `
          SELECT TenantId, EvaluationId, EvaluatorId, EvaluatorType, EvaluatorName,
            TraceId, IsGuardrail, Status, Score, Passed, Label
          FROM ${EVALUATION_RUNS_TABLE}
          WHERE ${tenantScope("ScheduledAt")}
            AND ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})
            AND TraceId IN ({traceIds:Array(String)})
            AND (TenantId, EvaluationId, UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${EVALUATION_RUNS_TABLE}
              WHERE ${tenantScope("ScheduledAt")}
                AND ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY UpdatedAt DESC
        `,
        query_params: { traceIds: [...input.traceIds], since: input.since },
        format: "JSONEachRow",
      });
      return tenantSummaryRowsSchema
        .parse(await result.json())
        .flatMap((row) =>
          row.TraceId
            ? [{ tenantId: row.TenantId, ...evaluationSummarySchema.parse(summaryFields(row)) }]
            : [],
        );
    } catch (error) {
      logger.warn(
        { traceIdCount: input.traceIds.length, error },
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
        ...(await this.ownTenant(input.tenantId)),
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
        ...input,
        ...(await this.ownTenant(input.tenantId)),
        columns: TRACE_EVALUATION_COLUMNS_LIGHT,
      });
    }
  }

  /** As `findTraceEvaluations`, fenced by the proof on `ScheduledAt`, outer and dedup alike. */
  async findReadableTraceEvaluations(input: {
    authorization: Authorization;
    traceIds: readonly string[];
  }): Promise<Record<string, TraceEvaluationData[]>> {
    if (input.traceIds.length === 0) return {};
    return this.queryTraceEvaluations({
      traceIds: input.traceIds,
      client: this.clickhouse.as(input.authorization, { reads: "traces" }),
      tenantPredicate: tenantScope("ScheduledAt"),
      dedupTenantPredicate: tenantScope("ScheduledAt"),
      params: {},
      columns: TRACE_EVALUATION_COLUMNS_WITH_INPUTS,
    });
  }

  private async ownTenant(tenantId: string) {
    return {
      client: await this.resolveClient(tenantId),
      tenantPredicate: `${RUNS}.TenantId = {tenantId:String}`,
      dedupTenantPredicate: "TenantId = {tenantId:String}",
      params: { tenantId },
    };
  }

  private async queryTraceEvaluations(input: {
    client: TraceClickHouseClient;
    tenantPredicate: string;
    dedupTenantPredicate: string;
    params: Record<string, string>;
    traceIds: readonly string[];
    columns: string;
  }): Promise<Record<string, TraceEvaluationData[]>> {
    const result = await input.client.query({
      query: `
        SELECT ${input.columns}
        FROM ${EVALUATION_RUNS_TABLE} AS ${RUNS}
        WHERE ${input.tenantPredicate}
          AND ${RUNS}.TraceId IN ({traceIds:Array(String)})
          AND (${RUNS}.TenantId, ${RUNS}.EvaluationId, ${RUNS}.UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM ${EVALUATION_RUNS_TABLE}
            WHERE ${input.dedupTenantPredicate}
              AND TraceId IN ({traceIds:Array(String)})
            GROUP BY TenantId, EvaluationId
          )
      `,
      query_params: { ...input.params, traceIds: [...input.traceIds] },
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
