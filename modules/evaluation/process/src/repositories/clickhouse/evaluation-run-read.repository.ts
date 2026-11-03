import type { Authorization } from "@langwatch/authorization";
import {
  type AuthorizedClickHouse,
  type ClickHouseClientResolver,
  ClickHouseColumns,
  type IdBoundOptions,
  type IdBoundResolved,
  ownProjectIdOf,
  RetentionFloorService,
  singleTenantOf,
  TenantReaderClientUnavailableError,
  tenantScope,
  tenantScopeKey,
  tenantSet,
} from "@langwatch/clickhouse-client";
import {
  evaluationRunDataSchema,
  EvaluationNotFoundError,
  traceEvaluationDataSchema,
  type EvaluationRunData,
  type TraceEvaluationData,
} from "@langwatch/evaluation-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import { DEFAULT_SCHEDULED_AT_SLACK_MS } from "../../rules/evaluation-run-lookup.rules.ts";
import type {
  EvaluationInputsRead,
  EvaluationRunFloorLookup,
  EvaluationRetentionLookup,
} from "../evaluation.repository.ts";
import type { ClickHouseEvaluationRunRecord } from "./evaluation-run-write.repository.ts";

const TABLE_NAME = "evaluation_runs" as const;
const RESOLVER_RECENT_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;
const TRACE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const RUNS = "runs" as const;
const inputsRowSchema = z.object({ TenantId: z.string(), Inputs: z.string().nullable() });
const inputsRowsSchema = z.array(inputsRowSchema);
const logger = createLogger("langwatch:evaluation:clickhouse.evaluation-run-read");

/**
 * The attempt columns goose 00122 adds, each with the default it reads as until the tenant's
 * target has it (`ClickHouseColumns.select`, NO-HOLDS, ARCHITECTURE.md section 7).
 */
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

type ClickHouseEvaluationRunRow = ClickHouseEvaluationRunRecord & {
  LastAttemptAtMs: number | string | null;
  NextAttemptAtMs: number | string | null;
};

/** The tenant an unhinted read's retention floor is read for: the one it reads, else its own. */
function retentionTenantOf(authorization: Authorization): string {
  return (
    singleTenantOf({ authorization, reads: "traces" }) ??
    ownProjectIdOf({ authorization, reads: "traces" })
  );
}

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

type TraceEvaluationRow = {
  EvaluationId: string;
  EvaluatorId: string;
  EvaluatorType: string;
  EvaluatorName: string | null;
  TraceId: string | null;
  IsGuardrail: boolean | number | string;
  Status: string;
  Score: number | null;
  Passed: boolean | number | string | null;
  Label: string | null;
  Details: string | null;
  Error: string | null;
  Inputs?: string | null;
  ScheduledAt: number | string | null;
  StartedAt: number | string | null;
  CompletedAt: number | string | null;
};

function isFlagSet(flag: boolean | number | string): boolean {
  return flag === true || flag === 1 || flag === "1" || flag === "true";
}

type ScheduledAtRange = { scheduledAtFrom: number; scheduledAtTo?: number };

function toNumberOrNull(value: number | string | null): number | null {
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
    /** The proof-fenced reader every read goes through (ADR-177 block C; AGG-EVAL-PROOF). */
    clickhouse: AuthorizedClickHouse;
    /** The client whose column list says which attempt columns the tenant's target has. */
    resolveQueryClient?: ClickHouseClientResolver;
  }): EvaluationRunClickHouseReadRepository {
    return new EvaluationRunClickHouseReadRepository(options);
  }

  /** One floor per tenant lookup, so its cache outlives a read; built on first read. */
  private readonly floors = new WeakMap<EvaluationRetentionLookup, RetentionFloorService>();

  private constructor(
    private readonly options: {
      clickhouse: AuthorizedClickHouse;
      resolveQueryClient?: ClickHouseClientResolver;
    },
  ) {}

  /** The attempt columns the reader's own target answers, the missing ones as defaults. */
  private async attemptColumns({
    authorization,
    alias,
  }: {
    authorization: Authorization;
    alias: string;
  }): Promise<string> {
    const input = { table: TABLE_NAME, alias, columns: ATTEMPT_COLUMNS };
    const { resolveQueryClient } = this.options;
    if (!resolveQueryClient) return ClickHouseColumns.named(input);
    const tenantId = ownProjectIdOf({ authorization, reads: "traces" });
    // An unreachable client names every column; the read itself then fails as it would have.
    const client = await resolveQueryClient(tenantId).catch(() => undefined);
    if (!client) return ClickHouseColumns.named(input);
    return client.columns({ tenantId }).select(input);
  }

  /** The tenant's retention plus the floor's margin; the platform default when unreadable. */
  private floorOver(retention: EvaluationRetentionLookup): RetentionFloorService {
    const known = this.floors.get(retention);
    if (known) return known;
    const floor = new RetentionFloorService({
      defaultRetentionDays: retention.getPlatformDefaultRetentionDays(),
      provider: retention,
      logger,
    });
    this.floors.set(retention, floor);
    return floor;
  }

  async getByEvaluationId(input: EvaluationRunFloorLookup): Promise<EvaluationRunData> {
    let row: ClickHouseEvaluationRunRow | undefined;
    try {
      row = await this.findRunRow(input);
    } catch (error) {
      logger.warn(
        {
          evaluationId: input.evaluationId,
          scope: tenantScopeKey({ authorization: input.authorization, reads: "traces" }),
          error,
        },
        "Failed to get evaluation run from ClickHouse",
      );
      throw error;
    }
    if (!row) throw new EvaluationNotFoundError(input.evaluationId);
    return this.fromClickHouseRecord(row);
  }

  /**
   * A caller's `scheduledAt` bounds the read within its slack, never widening; without one the
   * id index does once ready, and before that the floor-and-probe ladder resolves the range.
   */
  private findRunRow(
    input: EvaluationRunFloorLookup,
  ): Promise<ClickHouseEvaluationRunRow | undefined> {
    const slackMs = input.scheduledAtSlackMs ?? DEFAULT_SCHEDULED_AT_SLACK_MS;
    const idBound: IdBoundOptions = input.scheduledAt
      ? { occurredAtHint: input.scheduledAt.getTime(), windowMs: slackMs, fallback: "none" }
      : { fallback: "none", resolveHint: () => this.resolveScheduledAtWindow(input) };
    return this.readRunRow({ input, idBound });
  }

  private async readRunRow({
    input,
    idBound,
  }: {
    input: EvaluationRunFloorLookup;
    idBound: IdBoundOptions;
  }): Promise<ClickHouseEvaluationRunRow | undefined> {
    const client = this.options.clickhouse.as(input.authorization, { reads: "traces" });
    const attempts = await this.attemptColumns({ authorization: input.authorization, alias: "t" });
    // The outer scope's bare `ScheduledAt` is the UInt64 alias below, so the windowed fence
    // reads the raw column in the dedup subquery; the outer scope takes the tenant set alone.
    const result = await client.query<ClickHouseEvaluationRunRow>({
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
          t.CostId AS CostId, ${attempts}, ${ATTEMPT_MOMENTS},
          t.LastProcessedEventId AS LastProcessedEventId,
          toUnixTimestamp64Milli(t.LastEventOccurredAt) AS LastEventOccurredAt
        FROM ${TABLE_NAME} AS t
        PREWHERE (t.TenantId, t.EvaluationId, t.UpdatedAt) IN (
          SELECT TenantId, EvaluationId, max(UpdatedAt)
          FROM ${TABLE_NAME}
          WHERE ${tenantScope("ScheduledAt")}
            AND EvaluationId = {evaluationId:String}
            {{idBound:evaluation_runs.EvaluationId:evaluationId}}
          GROUP BY TenantId, EvaluationId
        )
        WHERE ${tenantSet()}
          AND t.EvaluationId = {evaluationId:String}
          {{idBound:evaluation_runs.EvaluationId:evaluationId:t}}
        LIMIT 1
      `,
      query_params: { evaluationId: input.evaluationId },
      format: "JSONEachRow",
      idBound,
    });
    return (await result.json())[0];
  }

  async findByTraceId(input: {
    authorization: Authorization;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    try {
      const client = this.options.clickhouse.as(input.authorization, { reads: "traces" });
      const attempts = await this.attemptColumns({
        authorization: input.authorization,
        alias: RUNS,
      });
      const result = await client.query<ClickHouseEvaluationRunRow>({
        query: `
          SELECT ProjectionId, TenantId, EvaluationId, Version, EvaluatorId,
            EvaluatorType, EvaluatorName, TraceId, IsGuardrail, Status, Score,
            Passed, Label, Details, Inputs, Error, ErrorDetails,
            toUnixTimestamp64Milli(${RUNS}.CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(${RUNS}.UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(${RUNS}.ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(${RUNS}.ScheduledAt) AS ScheduledAt,
            toUnixTimestamp64Milli(${RUNS}.StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(${RUNS}.CompletedAt) AS CompletedAt, CostId,
            ${attempts}, ${ATTEMPT_MOMENTS}, LastProcessedEventId,
            toUnixTimestamp64Milli(${RUNS}.LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME} AS ${RUNS}
          WHERE ${tenantSet()}
            AND ${RUNS}.ScheduledAt >= now() - INTERVAL 7 DAY
            AND ${RUNS}.TraceId = {traceId:String}
            {{idBound:evaluation_runs.TraceId:traceId:${RUNS}}}
            AND (${RUNS}.TenantId, ${RUNS}.EvaluationId, ${RUNS}.UpdatedAt) IN (
              SELECT TenantId, EvaluationId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE ${tenantScope("ScheduledAt")}
                AND ScheduledAt >= now() - INTERVAL 7 DAY
                AND TraceId = {traceId:String}
                {{idBound:evaluation_runs.TraceId:traceId}}
              GROUP BY TenantId, EvaluationId
            )
          ORDER BY ${RUNS}.UpdatedAt DESC
        `,
        query_params: { traceId: input.traceId },
        format: "JSONEachRow",
        idBound: {
          occurredAtHint: nowInstant().epochMilliseconds,
          windowMs: TRACE_LOOKBACK_MS,
          fallback: "none",
        },
      });
      return (await result.json()).map((row) => this.fromClickHouseRecord(row));
    } catch (error) {
      logger.warn(
        {
          traceId: input.traceId,
          scope: tenantScopeKey({ authorization: input.authorization, reads: "traces" }),
          error,
        },
        "Failed to find evaluation runs by trace ID in ClickHouse",
      );
      throw error;
    }
  }

  /**
   * Each trace's latest evaluation versions, unordered, with no time bound of their own: only
   * the trace id index narrows the read. A memory-limit failure retries without the inputs.
   */
  async findTraceEvaluations(input: {
    authorization: Authorization;
    traceIds: readonly string[];
  }): Promise<TraceEvaluationData[]> {
    if (input.traceIds.length === 0) return [];
    try {
      return await this.queryTraceEvaluations({
        ...input,
        columns: TRACE_EVALUATION_COLUMNS_WITH_INPUTS,
      });
    } catch (error) {
      if (!isMemoryLimitError(error)) {
        logger.error(
          { traceIdCount: input.traceIds.length, error },
          "Failed to fetch trace evaluations from ClickHouse",
        );
        throw error;
      }
      logger.warn(
        { traceIdCount: input.traceIds.length },
        "Trace evaluation read hit the ClickHouse memory limit; retrying without inputs",
      );
      return this.queryTraceEvaluations({ ...input, columns: TRACE_EVALUATION_COLUMNS_LIGHT });
    }
  }

  private async queryTraceEvaluations(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    columns: string;
  }): Promise<TraceEvaluationData[]> {
    const client = this.options.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query<TraceEvaluationRow>({
      query: `
        SELECT ${input.columns}
        FROM ${TABLE_NAME} AS ${RUNS}
        WHERE ${tenantSet()}
          AND ${RUNS}.TraceId IN ({traceIds:Array(String)})
          {{idBound:evaluation_runs.TraceId:traceIds:${RUNS}}}
          AND (${RUNS}.TenantId, ${RUNS}.EvaluationId, ${RUNS}.UpdatedAt) IN (
            SELECT TenantId, EvaluationId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE ${tenantScope("ScheduledAt")}
              AND TraceId IN ({traceIds:Array(String)})
              {{idBound:evaluation_runs.TraceId:traceIds}}
            GROUP BY TenantId, EvaluationId
          )
      `,
      query_params: { traceIds: [...input.traceIds] },
      format: "JSONEachRow",
      idBound: { fallback: "unbounded" },
    });
    return (await result.json()).flatMap((row) =>
      row.TraceId
        ? [
            traceEvaluationDataSchema.parse({
              evaluationId: row.EvaluationId,
              evaluatorId: row.EvaluatorId,
              evaluatorType: row.EvaluatorType,
              evaluatorName: row.EvaluatorName,
              traceId: row.TraceId,
              isGuardrail: isFlagSet(row.IsGuardrail),
              status: row.Status,
              score: row.Score,
              passed: row.Passed === null ? null : isFlagSet(row.Passed),
              label: row.Label,
              details: row.Details,
              error: row.Error,
              ...(row.Inputs === undefined ? {} : { inputs: parseObject(row.Inputs) }),
              timestamps: {
                scheduledAt: toNumberOrNull(row.ScheduledAt),
                startedAt: toNumberOrNull(row.StartedAt),
                completedAt: toNumberOrNull(row.CompletedAt),
              },
            }),
          ]
        : [],
    );
  }

  async findInputs(input: {
    authorization: Authorization;
    evaluationId: string;
  }): Promise<EvaluationInputsRead | null> {
    try {
      const reader = this.options.clickhouse.as(input.authorization, { reads: "traces" });
      // Today's read has no time bound at all; only the index narrows it.
      const result = await reader.query({
        query: `
          SELECT TenantId, argMax(Inputs, UpdatedAt) AS Inputs
          FROM ${TABLE_NAME}
          WHERE ${tenantScope("ScheduledAt")}
            AND EvaluationId = {evaluationId:String}
            {{idBound:evaluation_runs.EvaluationId:evaluationId}}
          GROUP BY TenantId
          ORDER BY TenantId
          LIMIT 1
        `,
        query_params: { evaluationId: input.evaluationId },
        format: "JSONEachRow",
        idBound: { fallback: "unbounded" },
      });
      const row = inputsRowsSchema.parse(await result.json())[0];
      return row ? { tenantId: row.TenantId, inputs: parseObject(row.Inputs) } : null;
    } catch (error) {
      // An unreachable cluster or the memory ceiling answers no inputs (bound scenario);
      // any other failure throws.
      if (error instanceof TenantReaderClientUnavailableError || isMemoryLimitError(error)) {
        logger.warn(
          { evaluationId: input.evaluationId, error },
          "Evaluation inputs read degraded to none",
        );
        return null;
      }
      logger.warn(
        { evaluationId: input.evaluationId, error },
        "Failed to fetch evaluation inputs from ClickHouse",
      );
      throw error;
    }
  }

  /**
   * The not-ready ladder: the run's ScheduledAt within the recent probe, else above the
   * retention floor; with neither, every row above the floor, open above.
   */
  private async resolveScheduledAtWindow(
    input: EvaluationRunFloorLookup,
  ): Promise<IdBoundResolved> {
    const range = await this.resolveScheduledAtRange(input);
    return { fromMs: range.scheduledAtFrom, toMs: range.scheduledAtTo };
  }

  private async resolveScheduledAtRange(
    input: EvaluationRunFloorLookup,
  ): Promise<ScheduledAtRange> {
    const slackMs = input.scheduledAtSlackMs ?? DEFAULT_SCHEDULED_AT_SLACK_MS;

    const floorMs = await this.floorOver(input.retention).getFloorMs({
      table: TABLE_NAME,
      tenantId: retentionTenantOf(input.authorization),
    });
    const recent = await this.queryScheduledAtMs({
      authorization: input.authorization,
      evaluationId: input.evaluationId,
      sinceMs: nowInstant().epochMilliseconds - RESOLVER_RECENT_WINDOW_MS,
    });
    if (recent !== undefined) {
      return { scheduledAtFrom: recent - slackMs, scheduledAtTo: recent + slackMs };
    }
    const fallback = await this.queryScheduledAtMs({
      authorization: input.authorization,
      evaluationId: input.evaluationId,
      sinceMs: floorMs,
    });
    return fallback === undefined
      ? { scheduledAtFrom: floorMs }
      : { scheduledAtFrom: fallback - slackMs, scheduledAtTo: fallback + slackMs };
  }

  private async queryScheduledAtMs(input: {
    authorization: Authorization;
    evaluationId: string;
    sinceMs: number;
  }): Promise<number | undefined> {
    const client = this.options.clickhouse.as(input.authorization, { reads: "traces" });
    const result = await client.query<{ scheduledAtMs: number | string | null }>({
      // ID_BOUND_SKIP: the not-ready ladder's probe; the index path never runs it.
      query: `
        SELECT toUnixTimestamp64Milli(argMax(ScheduledAt, UpdatedAt)) AS scheduledAtMs
        FROM ${TABLE_NAME}
        WHERE ${tenantScope("ScheduledAt")}
          AND EvaluationId = {evaluationId:String}
          AND ScheduledAt >= fromUnixTimestamp64Milli({sinceMs:Int64})
      `,
      query_params: {
        evaluationId: input.evaluationId,
        sinceMs: input.sinceMs,
      },
      format: "JSONEachRow",
    });
    const raw = (await result.json())[0]?.scheduledAtMs;
    if (raw === null || raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  private fromClickHouseRecord(row: ClickHouseEvaluationRunRow): EvaluationRunData {
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
      archivedAt: toNumberOrNull(row.ArchivedAt),
      scheduledAt: toNumberOrNull(row.ScheduledAt),
      startedAt: toNumberOrNull(row.StartedAt),
      completedAt: toNumberOrNull(row.CompletedAt),
      costId: row.CostId,
      attempts: Number(row.Attempts ?? 0),
      lastAttemptAt: toNumberOrNull(row.LastAttemptAtMs ?? null),
      lastAttemptError: row.LastAttemptError ?? null,
      nextAttemptAt: toNumberOrNull(row.NextAttemptAtMs ?? null),
    });
  }
}
