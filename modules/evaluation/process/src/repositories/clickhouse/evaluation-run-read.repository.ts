import type { Authorization } from "@langwatch/authorization";
import {
  AuthorizedClickHouse,
  type ClickHouseClientResolver,
  ClickHouseColumns,
  type ClickHouseQueryClient,
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
  clickhouseRead,
  column,
  fn,
  param,
  tenantScope as builtScope,
  type ProofScope,
} from "@langwatch/clickhouse-client/builder";
import {
  evaluationOutcomeSchema,
  evaluationRunDataSchema,
  EvaluationNotFoundError,
  traceEvaluationDataSchema,
  type EvaluationOutcome,
  type EvaluationOutcomeCursor,
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
import { evaluationRuns } from "./clickhouse.evaluation-runs.table.ts";
import type { ClickHouseEvaluationRunRecord } from "./evaluation-run-write.repository.ts";

const TABLE_NAME = "evaluation_runs" as const;
const RESOLVER_RECENT_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;
const TRACE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** How long before its last event a finished run may have been scheduled and still be paged. */
const OUTCOME_SCHEDULE_SLACK_MS = 24 * 60 * 60 * 1000;
const outcomeFlagSchema = z.union([z.boolean(), z.number(), z.string()]);
const outcomeRowsSchema = z.array(
  z.object({
    EvaluationId: z.string(),
    LatestTraceId: z.string(),
    LatestEvaluatorName: z.string().nullable(),
    LatestIsGuardrail: outcomeFlagSchema,
    LatestStatus: z.string(),
    LatestPassed: outcomeFlagSchema.nullable(),
    LatestLabel: z.string().nullable(),
    LatestOccurredAt: z.union([z.number(), z.string()]),
    LatestEventId: z.string(),
  }),
);
const RUNS = "runs" as const;
const inputsRowSchema = z.object({ TenantId: z.string(), LatestInputs: z.string().nullable() });
const inputsRowsSchema = z.array(inputsRowSchema);
const logger = createLogger("langwatch:evaluation:clickhouse.evaluation-run-read");

/** The NO-HOLDS defaults the attempt columns (goose 00122) read as until the target has them. */
const NO_ATTEMPT_MOMENT = fn.nullAs(column.nullable(column.dateTime64({ precision: 3 })));
const NO_ATTEMPT_ERROR = fn.nullAs(column.nullable(column.string()));

/** The attempt columns the raw by-trace reads name, each with its NO-HOLDS default. */
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

/** A read row: no output takes a name the fence reads (ADR-201 §3), so those times end `Ms`. */
type ClickHouseEvaluationRunRow = Omit<
  ClickHouseEvaluationRunRecord,
  "UpdatedAt" | "ScheduledAt" | "StartedAt" | "LastAttemptAt" | "NextAttemptAt" | "_retention_days"
> & {
  UpdatedAtMs: number | string;
  ScheduledAtMs: number | string | null;
  StartedAtMs: number | string | null;
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
  `toUnixTimestamp64Milli(${RUNS}.ScheduledAt) AS ScheduledAtMs`,
  `toUnixTimestamp64Milli(${RUNS}.StartedAt) AS StartedAtMs`,
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
  ScheduledAtMs: number | string | null;
  StartedAtMs: number | string | null;
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
    /** The client every read resolves: built reads go through `read`, fenced by the proof. */
    resolveQueryClient: ClickHouseClientResolver;
  }): EvaluationRunClickHouseReadRepository {
    return new EvaluationRunClickHouseReadRepository(options);
  }

  /** One floor per tenant lookup, so its cache outlives a read; built on first read. */
  private readonly floors = new WeakMap<EvaluationRetentionLookup, RetentionFloorService>();
  /** The proof-fenced reader the two by-trace reads still go through (ADR-177 block C). */
  private readonly clickhouse: AuthorizedClickHouse;

  private constructor(private readonly options: { resolveQueryClient: ClickHouseClientResolver }) {
    this.clickhouse = new AuthorizedClickHouse({ resolveClient: options.resolveQueryClient });
  }

  /** The proof's fenced scope and the client of the project it routes to. */
  private async readerFor(
    authorization: Authorization,
  ): Promise<{ scope: ProofScope; client: Pick<ClickHouseQueryClient, "read" | "columns"> }> {
    const scope = builtScope.fromProof({ authorization, reads: "traces" });
    // An unreachable client fails as the fenced reader's does, so callers degrade by kind.
    const client = await this.options.resolveQueryClient(scope.routeTenantId).catch((cause) => {
      throw new TenantReaderClientUnavailableError({ cause });
    });
    return { scope, client };
  }

  /** Which attempt columns the reader's own target holds; an unreadable list holds all. */
  private static async attemptsHeld({
    client,
    tenantId,
  }: {
    client: Pick<ClickHouseQueryClient, "columns">;
    tenantId: string;
  }): Promise<(name: string) => boolean> {
    return client
      .columns({ tenantId })
      .holds({ table: TABLE_NAME })
      .catch(() => () => true);
  }

  /** The attempt columns the reader's own target answers, the missing ones as defaults. */
  private async attemptColumns({
    authorization,
    alias,
  }: {
    authorization: Authorization;
    alias: string;
  }): Promise<string> {
    const input = { table: TABLE_NAME, alias, columns: ATTEMPT_COLUMNS };
    const tenantId = ownProjectIdOf({ authorization, reads: "traces" });
    // An unreachable client names every column; the read itself then fails as it would have.
    const client = await this.options.resolveQueryClient(tenantId).catch(() => undefined);
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
    const { scope, client } = await this.readerFor(input.authorization);
    const holds = await EvaluationRunClickHouseReadRepository.attemptsHeld({
      client,
      tenantId: scope.routeTenantId,
    });
    const r = evaluationRuns;
    // No output takes a name the fence reads (ADR-201 §3): those times leave as `…Ms`. The
    // election repeats the windowed fence and the id bound under PREWHERE.
    const statement = clickhouseRead({ scope })
      .from(r)
      .withinWindows()
      .select({
        ProjectionId: r.ProjectionId,
        TenantId: r.TenantId,
        EvaluationId: r.EvaluationId,
        Version: r.Version,
        EvaluatorId: r.EvaluatorId,
        EvaluatorType: r.EvaluatorType,
        EvaluatorName: r.EvaluatorName,
        TraceId: r.TraceId,
        IsGuardrail: r.IsGuardrail,
        Status: r.Status,
        Score: r.Score,
        Passed: r.Passed,
        Label: r.Label,
        Details: r.Details,
        Inputs: r.Inputs,
        Error: r.Error,
        ErrorDetails: r.ErrorDetails,
        CreatedAtMs: fn.toUnixTimestamp64Milli(r.CreatedAt),
        UpdatedAtMs: fn.toUnixTimestamp64Milli(r.UpdatedAt),
        ArchivedAtMs: fn.toUnixTimestamp64Milli(r.ArchivedAt),
        ScheduledAtMs: fn.toUnixTimestamp64Milli(r.ScheduledAt),
        StartedAtMs: fn.toUnixTimestamp64Milli(r.StartedAt),
        CompletedAtMs: fn.toUnixTimestamp64Milli(r.CompletedAt),
        CostId: r.CostId,
        AttemptCount: fn.heldOr(r.Attempts, { holds, otherwise: param.uint16(0) }),
        LastAttemptAtMs: fn.toUnixTimestamp64Milli(
          fn.heldOr(r.LastAttemptAt, { holds, otherwise: NO_ATTEMPT_MOMENT }),
        ),
        LastAttemptErrorText: fn.heldOr(r.LastAttemptError, { holds, otherwise: NO_ATTEMPT_ERROR }),
        NextAttemptAtMs: fn.toUnixTimestamp64Milli(
          fn.heldOr(r.NextAttemptAt, { holds, otherwise: NO_ATTEMPT_MOMENT }),
        ),
        LastProcessedEventId: r.LastProcessedEventId,
        LastEventOccurredAtMs: fn.toUnixTimestamp64Milli(r.LastEventOccurredAt),
      })
      .where(({ idBound }) => idBound(r.EvaluationId, input.evaluationId))
      .latestVersion({ prewhere: true })
      .limit(1)
      .build();
    const result = await client.read({ statement, idBound });
    const [row] = result.rows;
    if (!row) return undefined;
    return {
      ...row,
      CreatedAt: row.CreatedAtMs,
      ArchivedAt: row.ArchivedAtMs,
      CompletedAt: row.CompletedAtMs,
      Attempts: row.AttemptCount,
      LastAttemptError: row.LastAttemptErrorText,
      LastEventOccurredAt: row.LastEventOccurredAtMs,
    };
  }

  async findByTraceId(input: {
    authorization: Authorization;
    traceId: string;
  }): Promise<EvaluationRunData[]> {
    try {
      const client = this.clickhouse.as(input.authorization, { reads: "traces" });
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
            toUnixTimestamp64Milli(${RUNS}.UpdatedAt) AS UpdatedAtMs,
            toUnixTimestamp64Milli(${RUNS}.ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(${RUNS}.ScheduledAt) AS ScheduledAtMs,
            toUnixTimestamp64Milli(${RUNS}.StartedAt) AS StartedAtMs,
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
   * Finished runs on a trace whose last event is at or after `sinceMs`, after the cursor, oldest
   * first: each run's latest version by argMax over light columns. A run is scheduled before it
   * finishes, so the partition bound reaches a day below the later of `sinceMs` and the cursor.
   */
  async findOutcomesSince(input: {
    authorization: Authorization;
    sinceMs: number;
    after: EvaluationOutcomeCursor | null;
    limit: number;
  }): Promise<EvaluationOutcome[]> {
    const { scope, client } = await this.readerFor(input.authorization);
    const r = evaluationRuns;
    const latest = <V>(
      of: Parameters<typeof fn.argMax<V, "evaluation_runs", "evaluation_runs">>[0],
    ) => fn.argMax(of, r.UpdatedAt);
    const occurredAtMs = fn.toUnixTimestamp64Milli(latest(r.LastEventOccurredAt));
    const scheduledFrom =
      Math.max(input.sinceMs, input.after?.occurredAt ?? input.sinceMs) - OUTCOME_SCHEDULE_SLACK_MS;
    // ID_BOUND_SKIP: a page by time range, not a read by id.
    const statement = clickhouseRead({ scope })
      .from(r)
      .withinWindows()
      .select({
        EvaluationId: r.EvaluationId,
        LatestTraceId: latest(r.TraceId),
        LatestEvaluatorName: latest(r.EvaluatorName),
        LatestIsGuardrail: latest(r.IsGuardrail),
        LatestStatus: latest(r.Status),
        LatestPassed: latest(r.Passed),
        LatestLabel: latest(r.Label),
        LatestOccurredAt: occurredAtMs,
        LatestEventId: latest(r.LastProcessedEventId),
      })
      .where(({ gte }) => gte(r.ScheduledAt, scheduledFrom))
      .groupBy(r.TenantId, r.EvaluationId)
      .having(({ and, oneOf, ne, gte, gt }) =>
        and(
          oneOf(latest(r.Status), ["processed", "error", "skipped"]),
          ne(fn.ifNull(latest(r.TraceId), ""), ""),
          gte(occurredAtMs, param.int64(input.sinceMs)),
          gt(
            fn.tuple(occurredAtMs, r.EvaluationId),
            fn.tuple(
              param.int64(input.after?.occurredAt ?? -1),
              param.string(input.after?.evaluationId ?? ""),
            ),
          ),
        ),
      )
      .orderBy("LatestOccurredAt", "ASC")
      .orderBy("EvaluationId", "ASC")
      .limit(input.limit)
      .build();
    const result = { json: async () => (await client.read({ statement })).rows };
    return outcomeRowsSchema.parse(await result.json()).map((row) =>
      evaluationOutcomeSchema.parse({
        evaluationId: row.EvaluationId,
        traceId: row.LatestTraceId,
        evaluatorName: row.LatestEvaluatorName,
        isGuardrail: isFlagSet(row.LatestIsGuardrail),
        status: row.LatestStatus,
        passed: row.LatestPassed === null ? null : isFlagSet(row.LatestPassed),
        label: row.LatestLabel,
        occurredAt: Number(row.LatestOccurredAt),
        lastEventId: row.LatestEventId,
      }),
    );
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
    const client = this.clickhouse.as(input.authorization, { reads: "traces" });
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
                scheduledAt: toNumberOrNull(row.ScheduledAtMs),
                startedAt: toNumberOrNull(row.StartedAtMs),
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
      const { scope, client } = await this.readerFor(input.authorization);
      const r = evaluationRuns;
      // Today's read has no time bound at all; only the index narrows it.
      const statement = clickhouseRead({ scope })
        .from(r)
        .withinWindows()
        .select({ TenantId: r.TenantId, LatestInputs: fn.argMax(r.Inputs, r.UpdatedAt) })
        .where(({ idBound }) => idBound(r.EvaluationId, input.evaluationId))
        .groupBy(r.TenantId)
        .orderBy(r.TenantId)
        .limit(1)
        .build();
      const result = {
        json: async () =>
          (await client.read({ statement, idBound: { fallback: "unbounded" } })).rows,
      };
      const row = inputsRowsSchema.parse(await result.json())[0];
      return row ? { tenantId: row.TenantId, inputs: parseObject(row.LatestInputs) } : null;
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
    const { scope, client } = await this.readerFor(input.authorization);
    const r = evaluationRuns;
    // ID_BOUND_SKIP: the not-ready ladder's probe; the index path never runs it.
    const statement = clickhouseRead({ scope })
      .from(r)
      .withinWindows()
      .select({
        scheduledAtMs: fn.toUnixTimestamp64Milli(fn.argMax(r.ScheduledAt, r.UpdatedAt)),
      })
      .where(({ and, eq, gte }) =>
        and(eq(r.EvaluationId, input.evaluationId), gte(r.ScheduledAt, input.sinceMs)),
      )
      .build();
    const result = { json: async () => (await client.read({ statement })).rows };
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
      updatedAt: Number(row.UpdatedAtMs),
      LastEventOccurredAt: Number(row.LastEventOccurredAt ?? 0),
      archivedAt: toNumberOrNull(row.ArchivedAt),
      scheduledAt: toNumberOrNull(row.ScheduledAtMs),
      startedAt: toNumberOrNull(row.StartedAtMs),
      completedAt: toNumberOrNull(row.CompletedAt),
      costId: row.CostId,
      attempts: Number(row.Attempts ?? 0),
      lastAttemptAt: toNumberOrNull(row.LastAttemptAtMs ?? null),
      lastAttemptError: row.LastAttemptError ?? null,
      nextAttemptAt: toNumberOrNull(row.NextAttemptAtMs ?? null),
    });
  }
}
