import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { RUN_NOTE_EXPR } from "../repositories/simulation.clickhouse.repository";
import type { ResultsFilter, ResultsGroupBy } from "./atom.types";
import {
  ATOM_SORT_KEY,
  atomScopeSql,
  buildAtomFilters,
  COST_NUMERIC_EXPR,
  COST_SOURCE_EXPR,
  COST_UNKNOWN_EXPR,
  COST_VALUE_EXPR,
  groupKeyExpr,
  OUTCOME_EXPR,
  TARGET_KEY_EXPR,
  TRIGGER_EXPR,
  trendKeyExpr,
} from "./atom-sql";

/** Hard ceiling on one page of atoms, whatever the caller asks for. */
export const MAX_ATOM_PAGE = 500;

/** Most bars a sparkline draws. See the group trend contract. */
export const MAX_TREND_POINTS = 14;

/**
 * An atom as ClickHouse returns it: everything that lives on the run row.
 *
 * The plan slug, the plan name and the scenario name are NOT here. They live
 * in Postgres, and joining them in the query would mean a second store in the
 * hot path for values the caller already holds.
 */
export interface RawAtomRow {
  SetId: string;
  BatchRunId: string;
  ScenarioRunId: string;
  ScenarioId: string;
  Status: string;
  Outcome: string;
  RunAt: string;
  DurationMs: string;
  Note: string;
  TargetKey: string;
  Trigger: string;
  CostUsd: string;
  CostSource: string;
  SortKey: string;
}

/** One run of one plan, with the position that gives it its number. */
export interface RunOrdinalRow {
  SetId: string;
  BatchRunId: string;
  RunAt: string;
  Ordinal: string;
}

/** One group as ClickHouse folds it, before names are attached. */
export interface RawGroupRow {
  GroupKey: string;
  Atoms: string;
  Passed: string;
  Settled: string;
  RunCount: string;
  ScenarioCount: string;
  LastRunAt: string;
  TargetKeys: string[];
  CostTotal: string;
  CostUnknown: string;
}

/** One sparkline bar, still keyed to its group. */
export interface RawTrendRow {
  GroupKey: string;
  TrendKey: string;
  RunAt: string;
  Passed: string;
  Settled: string;
}

/** One bucket of the pass-rate-over-time chart. */
export interface RawSeriesRow {
  Bucket: string;
  Passed: string;
  Settled: string;
}

/** Project-wide counts the stat strip reads. */
export interface RawTotalsRow {
  Atoms: string;
  Passed: string;
  Settled: string;
  RunCount: string;
  FailingScenarios: string;
  CostTotal: string;
  CostUnknown: string;
}

interface AtomCursor {
  ts: string;
  executionId: string;
}

/**
 * The atom reads that back the Results tab.
 *
 * Kept apart from `SimulationClickHouseRepository` because it answers a
 * different question. That repository serves v1, which reads runs one batch or
 * one set at a time; this one reads the whole window flat so a filter can cut
 * it and a grouping can fold it. Nothing here changes what v1 reads.
 */
export class ResultAtomsClickHouseRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  private async getClient(tenantId: string): Promise<ClickHouseClient> {
    if (!tenantId) {
      throw new Error("tenantId is required for ClickHouse client resolution");
    }
    return this.resolveClient(tenantId);
  }

  private async queryRows<T>(
    query: string,
    params: { tenantId: string } & Record<string, string | string[]>,
  ): Promise<T[]> {
    const client = await this.getClient(params.tenantId);
    const result = await client.query({
      query,
      query_params: params,
      format: "JSONEachRow",
    });
    return result.json<T>();
  }

  /**
   * One page of atoms, newest first, keyset paginated.
   *
   * Newest first because that is the order the page reads in; the cursor
   * therefore walks backwards through the same expression it sorts by. Ties on
   * the timestamp break on the scenario run id, so two runs that started in the
   * same millisecond cannot both sit on a page boundary and be skipped.
   */
  async findAtoms({
    filter,
    limit,
    cursor,
  }: {
    filter: ResultsFilter;
    limit: number;
    cursor?: string;
  }): Promise<{ atoms: RawAtomRow[]; nextCursor?: string; hasMore: boolean }> {
    if (isEmptyScope(filter)) {
      return { atoms: [], hasMore: false };
    }
    const pageSize = Math.min(Math.max(1, limit), MAX_ATOM_PAGE);
    const filters = buildAtomFilters(filter);
    const decoded = cursor ? decodeCursor(cursor) : null;

    const cursorPredicate = decoded
      ? `AND (
          (${ATOM_SORT_KEY} < toUInt64({atomCursorTs:String}))
          OR (${ATOM_SORT_KEY} = toUInt64({atomCursorTs:String})
              AND ScenarioRunId < {atomCursorRunId:String})
        )`
      : "";

    const rows = await this.queryRows<RawAtomRow>(
      `SELECT
         ScenarioSetId AS SetId,
         BatchRunId,
         ScenarioRunId,
         ScenarioId,
         Status,
         ${OUTCOME_EXPR} AS Outcome,
         toString(${ATOM_SORT_KEY}) AS RunAt,
         ifNull(toString(DurationMs), '') AS DurationMs,
         ${RUN_NOTE_EXPR} AS Note,
         ${TARGET_KEY_EXPR} AS TargetKey,
         ${TRIGGER_EXPR} AS Trigger,
         ${COST_VALUE_EXPR} AS CostUsd,
         ${COST_SOURCE_EXPR} AS CostSource,
         toString(${ATOM_SORT_KEY}) AS SortKey
       ${atomScopeSql(filters)}
         ${cursorPredicate}
       ORDER BY ${ATOM_SORT_KEY} DESC, ScenarioRunId DESC
       LIMIT {atomLimit:UInt32}`,
      {
        tenantId: filter.projectId,
        ...filters.params,
        ...(decoded
          ? { atomCursorTs: decoded.ts, atomCursorRunId: decoded.executionId }
          : {}),
        atomLimit: String(pageSize + 1),
      },
    );

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const last = page[page.length - 1];

    return {
      atoms: page,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ ts: last.SortKey, executionId: last.ScenarioRunId })
          : undefined,
    };
  }

  /**
   * The number every run carries inside its plan, oldest first.
   *
   * Counted over the window, not over all time, because the run numbers the
   * runs sidebar already draws are window-scoped too and two numbers for one
   * run would be worse than a number that moves with the period.
   *
   * Read at batch grain rather than atom grain: a window holds far fewer runs
   * than scenario runs, so this stays small even where the atom list does not.
   */
  async findRunOrdinals(filter: ResultsFilter): Promise<RunOrdinalRow[]> {
    if (isEmptyScope(filter)) return [];
    const filters = buildAtomFilters(filter);
    return this.queryRows<RunOrdinalRow>(
      `SELECT
         SetId,
         BatchRunId,
         toString(RunAt) AS RunAt,
         toString(row_number() OVER (
           PARTITION BY SetId ORDER BY RunAt ASC, BatchRunId ASC
         )) AS Ordinal
       FROM (
         SELECT
           ScenarioSetId AS SetId,
           BatchRunId,
           min(${ATOM_SORT_KEY}) AS RunAt
         ${atomScopeSql(filters)}
         GROUP BY ScenarioSetId, BatchRunId
       )`,
      { tenantId: filter.projectId, ...filters.params },
    );
  }

  /** The stat strip counts, over every atom in scope. */
  async aggregateTotals(filter: ResultsFilter): Promise<RawTotalsRow | null> {
    if (isEmptyScope(filter)) return null;
    const filters = buildAtomFilters(filter);
    const rows = await this.queryRows<RawTotalsRow>(
      `SELECT
         toString(count())                                        AS Atoms,
         toString(countIf(Outcome = 'passed'))                    AS Passed,
         toString(countIf(Outcome != 'pending'))                  AS Settled,
         toString(uniqExact(BatchRunId))                          AS RunCount,
         toString(uniqExactIf(ScenarioId, Outcome = 'failed'))    AS FailingScenarios,
         toString(sum(CostUsd))                                   AS CostTotal,
         toString(sum(CostUnknown))                               AS CostUnknown
       FROM (
         SELECT
           BatchRunId,
           ScenarioId,
           ${OUTCOME_EXPR} AS Outcome,
           ${COST_NUMERIC_EXPR} AS CostUsd,
           ${COST_UNKNOWN_EXPR} AS CostUnknown
         ${atomScopeSql(filters)}
       )`,
      { tenantId: filter.projectId, ...filters.params },
    );
    return rows[0] ?? null;
  }

  /** One row per group, folded in the database so volume never reaches the client. */
  async aggregateGroups({
    filter,
    groupBy,
  }: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<RawGroupRow[]> {
    if (isEmptyScope(filter)) return [];
    const filters = buildAtomFilters(filter);
    return this.queryRows<RawGroupRow>(
      `SELECT
         GroupKey,
         toString(count())                       AS Atoms,
         toString(countIf(Outcome = 'passed'))   AS Passed,
         toString(countIf(Outcome != 'pending')) AS Settled,
         toString(uniqExact(BatchRunId))         AS RunCount,
         toString(uniqExact(ScenarioId))         AS ScenarioCount,
         toString(max(RunAt))                    AS LastRunAt,
         arraySort(groupUniqArray(TargetKey))    AS TargetKeys,
         toString(sum(CostUsd))                  AS CostTotal,
         toString(sum(CostUnknown))              AS CostUnknown
       FROM (
         SELECT
           ${groupKeyExpr(groupBy)} AS GroupKey,
           BatchRunId,
           ScenarioId,
           ${TARGET_KEY_EXPR} AS TargetKey,
           ${ATOM_SORT_KEY} AS RunAt,
           ${OUTCOME_EXPR} AS Outcome,
           ${COST_NUMERIC_EXPR} AS CostUsd,
           ${COST_UNKNOWN_EXPR} AS CostUnknown
         ${atomScopeSql(filters)}
       )
       GROUP BY GroupKey`,
      { tenantId: filter.projectId, ...filters.params },
    );
  }

  /**
   * The sparkline points of every group, at the grain that grouping calls for.
   *
   * Read whole rather than per group: one aggregate over the window is cheaper
   * than one query per row of the table, and the result is bounded by the run
   * count, not the atom count.
   */
  async aggregateTrend({
    filter,
    groupBy,
  }: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<RawTrendRow[]> {
    if (isEmptyScope(filter)) return [];
    const filters = buildAtomFilters(filter);
    return this.queryRows<RawTrendRow>(
      `SELECT
         GroupKey,
         TrendKey,
         toString(min(RunAt))                    AS RunAt,
         toString(countIf(Outcome = 'passed'))   AS Passed,
         toString(countIf(Outcome != 'pending')) AS Settled
       FROM (
         SELECT
           ${groupKeyExpr(groupBy)} AS GroupKey,
           ${trendKeyExpr(groupBy)} AS TrendKey,
           ${ATOM_SORT_KEY} AS RunAt,
           ${OUTCOME_EXPR} AS Outcome
         ${atomScopeSql(filters)}
       )
       GROUP BY GroupKey, TrendKey`,
      { tenantId: filter.projectId, ...filters.params },
    );
  }

  /**
   * Pass rate over time, in fixed buckets.
   *
   * Buckets that hold nothing are absent here and filled in by the caller, so
   * the chart can draw a gap rather than a zero, which would read as a total
   * failure instead of as no data.
   */
  async aggregateSeries({
    filter,
    bucketSeconds,
  }: {
    filter: ResultsFilter;
    bucketSeconds: number;
  }): Promise<RawSeriesRow[]> {
    if (isEmptyScope(filter)) return [];
    const filters = buildAtomFilters(filter);
    return this.queryRows<RawSeriesRow>(
      `SELECT
         toString(toUnixTimestamp(Bucket) * 1000)  AS Bucket,
         toString(countIf(Outcome = 'passed'))     AS Passed,
         toString(countIf(Outcome != 'pending'))   AS Settled
       FROM (
         SELECT
           toStartOfInterval(
             ifNull(StartedAt, CreatedAt),
             INTERVAL {atomBucketSeconds:UInt32} SECOND
           ) AS Bucket,
           ${OUTCOME_EXPR} AS Outcome
         ${atomScopeSql(filters)}
       )
       GROUP BY Bucket
       ORDER BY Bucket ASC`,
      {
        tenantId: filter.projectId,
        ...filters.params,
        atomBucketSeconds: String(bucketSeconds),
      },
    );
  }
}

/**
 * True when the caller asked for an empty set of scenarios or targets.
 *
 * An empty list means "none of them", not "all of them". Turning it into an
 * unfiltered query is how a filter that should show nothing shows everything,
 * so it short-circuits before any query is sent.
 */
function isEmptyScope(filter: ResultsFilter): boolean {
  return (
    filter.scenarioIds?.length === 0 ||
    filter.scenarioSetIds?.length === 0 ||
    filter.targetKeys?.length === 0
  );
}

function encodeCursor(cursor: AtomCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): AtomCursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as AtomCursor).ts === "string" &&
      typeof (parsed as AtomCursor).executionId === "string"
    ) {
      return parsed as AtomCursor;
    }
    return null;
  } catch {
    return null;
  }
}
