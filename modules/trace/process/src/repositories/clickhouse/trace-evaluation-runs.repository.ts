import type { Authorization } from "@langwatch/authorization";
import {
  type AuthorizedClickHouse,
  ClickHouseColumns,
  type ClickHouseQueryClient,
  ownProjectIdOf,
  tenantScope,
} from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  column,
  fn,
  param,
  type ReaderScope,
  tenantScope as builtTenantScope,
} from "@langwatch/clickhouse-client/builder";
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
import { evaluationRuns } from "./clickhouse.evaluation-runs.table.ts";
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
  `toUnixTimestamp64Milli(${RUNS}.ScheduledAt) AS ScheduledAtMs`,
  `toUnixTimestamp64Milli(${RUNS}.StartedAt) AS StartedAtMs`,
  `toUnixTimestamp64Milli(${RUNS}.CompletedAt) AS CompletedAt`,
].join(", ");
const TRACE_EVALUATION_COLUMNS_WITH_INPUTS = `${TRACE_EVALUATION_COLUMNS_LIGHT}, Inputs`;
const logger = createLogger("langwatch:trace:clickhouse.trace-evaluation-runs");

/** The attempt columns migration 00122 adds, each with the default it reads as until it lands. */
const ATTEMPT_COLUMNS = {
  Attempts: "toUInt16(0)",
  LastAttemptAt: "CAST(NULL AS Nullable(DateTime64(3)))",
  LastAttemptError: "CAST(NULL AS Nullable(String))",
  NextAttemptAt: "CAST(NULL AS Nullable(DateTime64(3)))",
} as const;

/** The attempt moments in epoch ms, read off the attempt columns' aliases. */
const ATTEMPT_MOMENTS = [
  "toUnixTimestamp64Milli(LastAttemptAt) AS LastAttemptAtMs",
  "toUnixTimestamp64Milli(NextAttemptAt) AS NextAttemptAtMs",
].join(", ");

const chFlag = z.union([z.boolean(), z.number(), z.string()]);
const nullableString = z.string().nullable();
const nullableNumber = chNumber.nullable();

const attemptRowShape = {
  Attempts: chNumber.optional(),
  LastAttemptAtMs: nullableNumber.optional(),
  LastAttemptError: nullableString.optional(),
  NextAttemptAtMs: nullableNumber.optional(),
};

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
  ScheduledAtMs: nullableNumber,
  StartedAtMs: nullableNumber,
  CompletedAt: nullableNumber,
  ...attemptRowShape,
});

/** A run row as `runsStatement` names it: each epoch-ms alias apart from its column's name. */
const runRowSchema = summaryRowSchema.safeExtend({
  Details: nullableString,
  Error: nullableString,
  Inputs: nullableString,
  ErrorDetails: nullableString,
  CreatedAtMs: chNumber,
  UpdatedAtMs: chNumber,
  ArchivedAtMs: nullableNumber,
  ScheduledAtMs: nullableNumber,
  StartedAtMs: nullableNumber,
  CompletedAtMs: nullableNumber,
  CostId: nullableString,
  AttemptCount: chNumber,
  LastAttemptAtMs: nullableNumber,
  LastAttemptErrorText: nullableString,
  NextAttemptAtMs: nullableNumber,
  LastEventOccurredAtMs: nullableNumber,
});

const tenantSummaryRowsSchema = z.array(summaryRowSchema.safeExtend({ TenantId: chString }));
const traceEvaluationRowsSchema = z.array(traceEvaluationRowSchema);
const runRowsSchema = z.array(runRowSchema);

type SummaryRow = z.infer<typeof summaryRowSchema>;
type AttemptRow = z.infer<z.ZodObject<typeof attemptRowShape>>;

/** The attempt fields of a run row; a target without the columns reads as no attempts. */
function attemptFields(row: AttemptRow) {
  return {
    attempts: row.Attempts ?? 0,
    lastAttemptAt: row.LastAttemptAtMs ?? null,
    lastAttemptError: row.LastAttemptError ?? null,
    nextAttemptAt: row.NextAttemptAtMs ?? null,
  };
}

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

/** Each run's latest version on a page's traces since `since`, under the fence on ScheduledAt. */
function summariesStatement({
  authorization,
  traceIds,
  since,
}: {
  authorization: Authorization;
  traceIds: readonly string[];
  since: number;
}) {
  return clickhouseRead({
    scope: builtTenantScope.fromProof({ authorization, reads: "traces" }),
  })
    .from(evaluationRuns)
    .withinWindows()
    .select({
      TenantId: evaluationRuns.TenantId,
      EvaluationId: evaluationRuns.EvaluationId,
      EvaluatorId: evaluationRuns.EvaluatorId,
      EvaluatorType: evaluationRuns.EvaluatorType,
      EvaluatorName: evaluationRuns.EvaluatorName,
      TraceId: evaluationRuns.TraceId,
      IsGuardrail: evaluationRuns.IsGuardrail,
      Status: evaluationRuns.Status,
      Score: evaluationRuns.Score,
      Passed: evaluationRuns.Passed,
      Label: evaluationRuns.Label,
    })
    .where(({ and, gte, oneOf }) =>
      and(gte(evaluationRuns.ScheduledAt, since), oneOf(evaluationRuns.TraceId, [...traceIds])),
    )
    .latestVersion()
    .orderBy(evaluationRuns.UpdatedAt, "DESC")
    .build();
}

const NULL_MOMENT = () => fn.nullAs(column.nullable(column.dateTime64({ precision: 3 })));

/**
 * A trace's runs of the last 7 days, each at its latest version; the attempt columns the target
 * lacks read as their defaults. Window and trace are two conditions, so the election repeats both.
 */
function runsStatement({
  scope,
  windows,
  traceId,
  holds,
}: {
  scope: ReaderScope;
  windows: boolean;
  traceId: string;
  holds: (name: string) => boolean;
}) {
  const from = clickhouseRead({ scope }).from(evaluationRuns);
  return (windows ? from.withinWindows() : from)
    .select({
      EvaluationId: evaluationRuns.EvaluationId,
      EvaluatorId: evaluationRuns.EvaluatorId,
      EvaluatorType: evaluationRuns.EvaluatorType,
      EvaluatorName: evaluationRuns.EvaluatorName,
      TraceId: evaluationRuns.TraceId,
      IsGuardrail: evaluationRuns.IsGuardrail,
      Status: evaluationRuns.Status,
      Score: evaluationRuns.Score,
      Passed: evaluationRuns.Passed,
      Label: evaluationRuns.Label,
      Details: evaluationRuns.Details,
      Inputs: evaluationRuns.Inputs,
      Error: evaluationRuns.Error,
      ErrorDetails: evaluationRuns.ErrorDetails,
      CreatedAtMs: fn.toUnixTimestamp64Milli(evaluationRuns.CreatedAt),
      UpdatedAtMs: fn.toUnixTimestamp64Milli(evaluationRuns.UpdatedAt),
      ArchivedAtMs: fn.toUnixTimestamp64Milli(evaluationRuns.ArchivedAt),
      ScheduledAtMs: fn.toUnixTimestamp64Milli(evaluationRuns.ScheduledAt),
      StartedAtMs: fn.toUnixTimestamp64Milli(evaluationRuns.StartedAt),
      CompletedAtMs: fn.toUnixTimestamp64Milli(evaluationRuns.CompletedAt),
      CostId: evaluationRuns.CostId,
      AttemptCount: fn.heldOr(evaluationRuns.Attempts, {
        holds,
        otherwise: fn.toUInt16(param.uint16(0)),
      }),
      LastAttemptAtMs: fn.toUnixTimestamp64Milli(
        fn.heldOr(evaluationRuns.LastAttemptAt, { holds, otherwise: NULL_MOMENT() }),
      ),
      LastAttemptErrorText: fn.heldOr(evaluationRuns.LastAttemptError, {
        holds,
        otherwise: fn.nullAs(column.nullable(column.string())),
      }),
      NextAttemptAtMs: fn.toUnixTimestamp64Milli(
        fn.heldOr(evaluationRuns.NextAttemptAt, { holds, otherwise: NULL_MOMENT() }),
      ),
      LastEventOccurredAtMs: fn.toUnixTimestamp64Milli(evaluationRuns.LastEventOccurredAt),
    })
    .where(({ gte }) => gte(evaluationRuns.ScheduledAt, fn.subtractDays(fn.now(), 7)))
    .where(({ eq }) => eq(evaluationRuns.TraceId, traceId))
    .latestVersion({ repeat: [evaluationRuns.TraceId] })
    .orderBy(evaluationRuns.UpdatedAt, "DESC")
    .build();
}

export class ClickHouseTraceEvaluationRunsRepository extends TraceEvaluationRunsReadRepository {
  static create(options: {
    resolveClient: TraceClickHouseResolver;
    clickhouse: AuthorizedClickHouse;
    reader: Pick<ClickHouseQueryClient, "read" | "columns">;
  }): ClickHouseTraceEvaluationRunsRepository {
    return new ClickHouseTraceEvaluationRunsRepository(
      options.resolveClient,
      options.clickhouse,
      options.reader,
    );
  }

  private constructor(
    private readonly resolveClient: TraceClickHouseResolver,
    private readonly clickhouse: AuthorizedClickHouse,
    private readonly reader: Pick<ClickHouseQueryClient, "read" | "columns">,
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
        scope: builtTenantScope.single({ tenantId: input.tenantId }),
        windows: false,
        tenantId: input.tenantId,
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
        scope: builtTenantScope.fromProof({ authorization: input.authorization, reads: "traces" }),
        windows: true,
        tenantId: ownProjectIdOf({ authorization: input.authorization, reads: "traces" }),
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

  /** `tenantId` names the target whose attempt columns the read selects. */
  private async queryRuns(input: {
    scope: ReaderScope;
    windows: boolean;
    tenantId: string;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    const holds = await this.reader
      .columns({ tenantId: input.tenantId })
      .holds({ table: evaluationRuns.$table.name });
    const result = await this.reader.read({
      // ID_BOUND_SKIP: evaluation's index, registered by evaluation; moves there with trace-review.
      statement: runsStatement({ ...input, holds }),
      table: evaluationRuns.$table.name,
    });
    return runRowsSchema.parse(result.rows).map((row) =>
      evaluationRunDataSchema.parse({
        ...summaryFields(row),
        details: row.Details,
        inputs: row.Inputs ? (JSON.parse(row.Inputs) as Record<string, unknown>) : null,
        error: row.Error,
        errorDetails: row.ErrorDetails,
        createdAt: row.CreatedAtMs,
        updatedAt: row.UpdatedAtMs,
        LastEventOccurredAt: row.LastEventOccurredAtMs ?? 0,
        archivedAt: row.ArchivedAtMs,
        scheduledAt: row.ScheduledAtMs,
        startedAt: row.StartedAtMs,
        completedAt: row.CompletedAtMs,
        costId: row.CostId,
        attempts: row.AttemptCount,
        lastAttemptAt: row.LastAttemptAtMs,
        lastAttemptError: row.LastAttemptErrorText,
        nextAttemptAt: row.NextAttemptAtMs,
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
      const result = await this.reader.read({
        // ID_BOUND_SKIP: evaluation's index, registered by evaluation; moves with trace-review.
        statement: summariesStatement(input),
        table: evaluationRuns.$table.name,
      });
      return tenantSummaryRowsSchema
        .parse(result.rows)
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
    const own = await this.ownTenant(input.tenantId);
    const attempts = await this.attemptColumns({ client: own.client });
    try {
      return await this.queryTraceEvaluations({
        ...input,
        ...own,
        attempts,
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
        ...own,
        attempts,
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
      attempts: await this.attemptColumnsOf({ authorization: input.authorization }),
      columns: TRACE_EVALUATION_COLUMNS_WITH_INPUTS,
    });
  }

  /** The attempt columns the tenant's target answers, the missing ones as their defaults. */
  private async attemptColumns({ client }: { client: TraceClickHouseClient }): Promise<string> {
    const input = { table: EVALUATION_RUNS_TABLE, alias: RUNS, columns: ATTEMPT_COLUMNS };
    return (await client.select?.(input)) ?? ClickHouseColumns.named(input);
  }

  /** As `attemptColumns`, for the proof's own project; an unreachable client names every column. */
  private async attemptColumnsOf({
    authorization,
  }: {
    authorization: Authorization;
  }): Promise<string> {
    const client = await this.resolveClient(
      ownProjectIdOf({ authorization, reads: "traces" }),
    ).catch(() => undefined);
    if (!client) {
      return ClickHouseColumns.named({ alias: RUNS, columns: ATTEMPT_COLUMNS });
    }
    return this.attemptColumns({ client });
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
    attempts: string;
  }): Promise<Record<string, TraceEvaluationData[]>> {
    // ID_BOUND_SKIP: evaluation's index, registered by evaluation; moves there with trace-review.
    const result = await input.client.query({
      query: `
        SELECT ${input.columns}, ${input.attempts}, ${ATTEMPT_MOMENTS}
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
          scheduledAt: row.ScheduledAtMs,
          startedAt: row.StartedAtMs,
          completedAt: row.CompletedAt,
        },
        ...attemptFields(row),
      });
      (output[row.TraceId] ??= []).push(evaluation);
    }
    return output;
  }
}
