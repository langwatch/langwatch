/**
 * The Results tab's own atom reads: run once per scenario/target off
 * `simulation_runs`, kept apart from `SimulationClickHouseRepository` (v1's
 * batch/set reads) since this reads the whole window flat for filter/group; SQL builders stay static methods per `restructure-bug-hunt-2026-09-03.md`.
 */
import {
  AGENT_TEST_SET_SUFFIX,
  expandSetIdFilter,
  UNKNOWN_TARGET_KEY,
  type ResultsFilter,
  type ResultsGroupBy,
} from "@langwatch/scenario-contract";
import {
  MAX_ATOM_PAGE,
  MAX_CODE_SCENARIOS,
  MAX_RUN_TARGETS,
  MAX_TREND_POINTS,
  ResultAtomsReadPort,
  type RawAtomRow,
  type RawCodeScenarioRow,
  type RawGroupRow,
  type RawRunTargetRow,
  type RawSeriesRow,
  type RawTotalsRow,
  type RawTrendRow,
  type RunOrdinalRow,
} from "../../ports/result-atoms-read.port";
import { mapStatus } from "./simulation-run.mapper";
import { RUN_NOTE_EXPR, TABLE_NAME } from "./simulation-clickhouse.repository";

/**
 * Raw `Status` values read as failure: stalled/cancelled count, and
 * `FAILURE` is the legacy spelling `mapStatus` folds into `FAILED`. Pinned
 * against `categorizeRunStatus` by a unit test so SQL and TS can't drift.
 */
export const FAILED_STATUS_VALUES = ["ERROR", "FAILED", "FAILURE", "STALLED", "CANCELLED"] as const;

/** Raw `Status` values that read as a pass. */
export const PASSED_STATUS_VALUES = ["SUCCESS"] as const;

const quoted = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(",");

/** How an atom's status reads: passed, failed or still pending. */
export const OUTCOME_EXPR = `multiIf(
  Status IN (${quoted(PASSED_STATUS_VALUES)}), 'passed',
  Status IN (${quoted(FAILED_STATUS_VALUES)}), 'failed',
  'pending')`;

/**
 * When the run started (epoch ms): ORDER BY, the cursor predicate and the
 * returned cursor must be this ONE coalesced expression, since ClickHouse
 * sorts a nullable `StartedAt` first and would strand those rows on page one.
 */
export const ATOM_SORT_KEY = "toUnixTimestamp64Milli(ifNull(StartedAt, CreatedAt))";

/**
 * The reserved namespace the platform stamps onto a run's metadata —
 * everything the platform knows sits under this one key, so a customer key
 * can never collide with it.
 */
export const LANGWATCH_METADATA = "JSONExtractRaw(ifNull(Metadata, '{}'), 'langwatch')";

/**
 * The target a run was pointed at, as the bare reference id — stamped by
 * the platform into a reserved namespace; an SDK/CI push carries none, and
 * nothing here resolves names (the client's own target map does).
 */
export const TARGET_REF_EXPR = `JSONExtractString(${LANGWATCH_METADATA}, 'targetReferenceId')`;

/**
 * The target key the platform stamped: reference id alone, or id + a hash
 * of parameter overrides. Empty on pre-target runs and any code-pushed run.
 * @see `@langwatch/suite-contract`'s `target-key.ts`
 */
export const TARGET_STAMP_KEY_EXPR = `JSONExtractString(${LANGWATCH_METADATA}, 'targetKey')`;

/**
 * Raw JSON of the run's target parameter overrides ('' when none) — kept
 * raw rather than mapped, since the values are strings/numbers/booleans and
 * re-typing them in SQL would lose which they were.
 */
export const TARGET_PARAMETERS_EXPR = `JSONExtractRaw(${LANGWATCH_METADATA}, 'targetParameters')`;

/**
 * Agent names the run reported, joined. Only the `agent` role (not the user
 * simulator or judge) names what the run tested; empty on any run pushed by
 * an older SDK that reported no agent.
 */
export const CODE_TARGET_NAME_EXPR = `arrayStringConcat(
  arrayMap(agent -> JSONExtractString(agent, 'name'),
    arrayFilter(agent ->
      JSONExtractString(agent, 'role') = 'agent'
      AND JSONExtractString(agent, 'name') != '',
      JSONExtractArrayRaw(ifNull(Metadata, '{}'), 'agents'))),
  ' vs ')`;

/**
 * Any name as a key: lower case, every stretch of anything but a letter or a
 * digit folded to one dash, no dash at either end. "List agents" and
 * "list-agents" fold to one key.
 */
function nameSlug(expr: string): string {
  return `trim(BOTH '-' FROM replaceRegexpAll(lowerUTF8(${expr}), '[^\\p{L}\\p{N}]+', '-'))`;
}

/** The reported agent names as a key, folded the way a scenario name is. */
export const CODE_TARGET_SLUG_EXPR = nameSlug(CODE_TARGET_NAME_EXPR);

/**
 * The key a target folds under: the platform's stamped key when present, a
 * stored agent/prompt reference id for pre-stamp runs, `code:<name>` for a
 * code-pushed run, otherwise `unknown` (the page's default target).
 */
export const TARGET_KEY_EXPR = `multiIf(
  ${TARGET_STAMP_KEY_EXPR} != '', ${TARGET_STAMP_KEY_EXPR},
  ${TARGET_REF_EXPR} != '', ${TARGET_REF_EXPR},
  ${CODE_TARGET_SLUG_EXPR} != '', concat('code:', ${CODE_TARGET_SLUG_EXPR}),
  '${UNKNOWN_TARGET_KEY}')`;

/**
 * What started the run: no trigger column exists, since a platform run
 * always stamps a target (both the one-off and suite paths) and an SDK/CI
 * push never does — the target's presence IS the signal, at no extra cost.
 */
export const TRIGGER_EXPR = `if(${TARGET_REF_EXPR} = '', 'code', 'app')`;

/**
 * The set a run belongs to, the empty id read as `default` the way every
 * other read of a set that runs from code does.
 */
export const SET_KEY_EXPR = `if(ScenarioSetId = '', 'default', ScenarioSetId)`;

/** A run's name as a key, so two spellings of one scenario fold together. */
export const NAME_SLUG_EXPR = nameSlug("ifNull(Name, '')");

/**
 * The key a scenario folds under: a platform run's stored scenario id, or
 * for a code run `<set>:<name>` (what the SDK would have derived) so two
 * runs of one scenario fold together; the filter reads this same key.
 */
export const SCENARIO_KEY_EXPR = `if(${TARGET_REF_EXPR} = '' AND ${NAME_SLUG_EXPR} != '', concat(${SET_KEY_EXPR}, '-', ${NAME_SLUG_EXPR}), ScenarioId)`;

const TRACE_METRIC_KEYS = "JSONExtractKeys(TraceMetricsJson)";

/**
 * Per-trace costs, summed from `TraceMetricsJson` (keyed by trace id, so
 * already distinct) — NOT from `TraceIds`, which held ~3x as many entries as
 * distinct traces on local data and would triple the reported cost.
 */
const TRACE_COST_SUM = `arraySum(arrayMap(
  traceKey -> JSONExtractFloat(JSONExtractRaw(TraceMetricsJson, traceKey), 'totalCost'),
  ${TRACE_METRIC_KEYS}))`;

/**
 * Cost source, ordered so NULL `TotalCost` (traces summed to zero) is told
 * apart from truly unmeasured: reading the per-trace map next resolved 260
 * of 309 NULL rows on local data; summing `TotalCost` alone under-reports.
 */
export const COST_SOURCE_EXPR = `multiIf(
  TotalCost IS NOT NULL, 'run',
  length(${TRACE_METRIC_KEYS}) > 0, 'traces',
  length(TraceIds) = 0, 'none',
  'unknown')`;

/** The atom's cost, as a string, with '' standing for "never measured". */
export const COST_VALUE_EXPR = `multiIf(
  TotalCost IS NOT NULL, toString(TotalCost),
  length(${TRACE_METRIC_KEYS}) > 0, toString(${TRACE_COST_SUM}),
  length(TraceIds) = 0, '0',
  '')`;

/** The cost as a number for aggregation, with a never-measured atom as zero. */
export const COST_NUMERIC_EXPR = `multiIf(
  TotalCost IS NOT NULL, TotalCost,
  length(${TRACE_METRIC_KEYS}) > 0, ${TRACE_COST_SUM},
  0)`;

/** 1 when the atom's cost was never measured. */
export const COST_UNKNOWN_EXPR = `if(${COST_SOURCE_EXPR} = 'unknown', 1, 0)`;

/**
 * `StartedAt` moves (null -> `CreatedAt` -> started event), so a tight
 * range filter can drop the true latest version from its own dedup group.
 * @see dev/docs/best_practices/clickhouse-queries.md — "A range filter on a MOVABLE column"
 */
export const DEDUP_WINDOW_SLACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface AtomFilterSql {
  /**
   * Predicates safe inside the dedup subquery: a run never moves between
   * sets, and `ScenarioSetId` is part of the dedup key already, so narrowing
   * on it picks the same version either way.
   */
  stableClause: string;
  /**
   * Predicates only valid AFTER dedup, since the column they read can differ
   * between versions of one run — e.g. `Status` could resolve a finished run
   * to an old version that still said "running".
   */
  volatileClause: string;
  /** The widened window for the dedup subquery. See {@link DEDUP_WINDOW_SLACK_MS}. */
  dedupWindowClause: string;
  params: Record<string, string | string[]>;
}

/** A set of WHERE predicates and the query parameters they read. */
interface FilterParts {
  parts: string[];
  params: Record<string, string | string[]>;
}

/** The predicates that may run inside the dedup subquery. */
function stableFilterParts(filter: ResultsFilter): FilterParts {
  // An atom is one scenario, one target, one run. A row that names no
  // scenario answers none of those: it groups under an empty key and reads
  // as a row with no name.
  const parts: string[] = [
    "ScenarioId != ''",
    // A "Test agent" run is a check of an agent, not a result of a scenario.
    `NOT endsWith(ScenarioSetId, '${AGENT_TEST_SET_SUFFIX}')`,
  ];
  const params: Record<string, string | string[]> = {};

  if (filter.scenarioSetIds && filter.scenarioSetIds.length > 0) {
    parts.push("ScenarioSetId IN ({atomSetIds:Array(String)})");
    params.atomSetIds = filter.scenarioSetIds.flatMap((setId) => expandSetIdFilter(setId));
  }

  return { parts, params };
}

/** The `Status` predicate a verdict filter asks for, if it asks for one. */
function outcomePart(outcome: ResultsFilter["outcome"]): string | null {
  if (outcome === "passed") {
    return `Status IN (${quoted(PASSED_STATUS_VALUES)})`;
  }

  if (outcome === "failed") {
    return `Status IN (${quoted(FAILED_STATUS_VALUES)})`;
  }

  if (outcome === "pending") {
    return `Status NOT IN (${quoted([...PASSED_STATUS_VALUES, ...FAILED_STATUS_VALUES])})`;
  }

  return null;
}

/** The predicates that may only run after dedup. */
function volatileFilterParts(filter: ResultsFilter): FilterParts {
  const params: Record<string, string | string[]> = {
    atomStartMs: String(filter.startDate),
  };
  // The lower bound always applies and is what prunes partitions. The upper
  // bound is deliberately optional: a live view sends none, so a run that
  // starts while the page is open still lands in the window.
  const parts = ["StartedAt >= fromUnixTimestamp64Milli(toUInt64({atomStartMs:String}))"];
  if (filter.endDate !== undefined) {
    params.atomEndMs = String(filter.endDate);
    parts.push("StartedAt <= fromUnixTimestamp64Milli(toUInt64({atomEndMs:String}))");
  }

  const outcome = outcomePart(filter.outcome);
  if (outcome !== null) {
    parts.push(outcome);
  }

  if (filter.targetKeys && filter.targetKeys.length > 0) {
    parts.push(`${TARGET_KEY_EXPR} IN ({atomTargetKeys:Array(String)})`);
    params.atomTargetKeys = filter.targetKeys;
  }

  // A scenario is named by its key, and the name a code run folds under can
  // arrive with a later version of the run, so the key is read after dedup.
  if (filter.scenarioIds && filter.scenarioIds.length > 0) {
    parts.push(`${SCENARIO_KEY_EXPR} IN ({atomScenarioIds:Array(String)})`);
    params.atomScenarioIds = filter.scenarioIds;
  }

  return { parts, params };
}

/** The widened window the dedup subquery prunes partitions with. */
function dedupWindowParts(filter: ResultsFilter): FilterParts {
  const params: Record<string, string | string[]> = {
    atomDedupStartMs: String(Math.max(0, filter.startDate - DEDUP_WINDOW_SLACK_MS)),
  };
  const parts = ["StartedAt >= fromUnixTimestamp64Milli(toUInt64({atomDedupStartMs:String}))"];
  if (filter.endDate !== undefined) {
    params.atomDedupEndMs = String(filter.endDate + DEDUP_WINDOW_SLACK_MS);
    parts.push("StartedAt <= fromUnixTimestamp64Milli(toUInt64({atomDedupEndMs:String}))");
  }

  return { parts, params };
}

/** The predicates as one appendable fragment, or nothing when there are none. */
function andClause(parts: string[]): string {
  return parts.length > 0 ? `AND ${parts.join(" AND ")}` : "";
}

interface AtomCursor {
  ts: string;
  executionId: string;
}

function encodeCursor(cursor: AtomCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): AtomCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
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

/**
 * An empty requested set means "none of them", not "all" — turning it into
 * an unfiltered query would show everything instead of nothing, so this
 * short-circuits before any query is sent.
 */
function isEmptyScope(filter: ResultsFilter): boolean {
  return (
    filter.scenarioIds?.length === 0 ||
    filter.scenarioSetIds?.length === 0 ||
    filter.targetKeys?.length === 0
  );
}

/** The raw ClickHouse row, `Status` unmapped. Internal to this file only. */
type RawAtomQueryRow = Omit<RawAtomRow, "Status"> & { Status: string };

/**
 * Narrow duck-typed slice of `ClickHouseClient` this repository reads
 * through, so the composition root can hand it the same routed-tenant
 * client v1's `SimulationReadClient` already composes, with no cast.
 */
type ResultAtomsClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, string | string[]>;
    format: "JSONEachRow";
  }): Promise<{ json<Result>(): Promise<Result[]> }>;
};

export class ResultAtomsClickHouseRepository extends ResultAtomsReadPort {
  static create(
    resolveClient: ResultAtomsClickHouseClientResolver,
  ): ResultAtomsClickHouseRepository {
    return new ResultAtomsClickHouseRepository(resolveClient);
  }

  /** The column a grouping folds on. */
  static groupKeyExpr(groupBy: ResultsGroupBy): string {
    switch (groupBy) {
      case "plan":
        return "ScenarioSetId";
      case "scenario":
        return SCENARIO_KEY_EXPR;
      case "target":
        return TARGET_KEY_EXPR;
      case "none":
        return "ScenarioRunId";
    }
  }

  /**
   * The grain of one sparkline bar: a run plan row covers many scenarios (so
   * folds a whole run), while a scenario or target row already names one
   * thing, so each bar is one execution of it.
   */
  static trendKeyExpr(groupBy: ResultsGroupBy): string {
    return groupBy === "plan" ? "BatchRunId" : "ScenarioRunId";
  }

  /**
   * Builds the WHERE fragments both reads share: one builder on purpose, so
   * the overview and the atom list can never disagree about what's in scope.
   */
  static buildAtomFilters(filter: ResultsFilter): AtomFilterSql {
    const stable = stableFilterParts(filter);
    const volatilePredicates = volatileFilterParts(filter);
    const dedupWindow = dedupWindowParts(filter);

    return {
      stableClause: andClause(stable.parts),
      volatileClause: andClause(volatilePredicates.parts),
      dedupWindowClause: andClause(dedupWindow.parts),
      params: { ...stable.params, ...volatilePredicates.params, ...dedupWindow.params },
    };
  }

  /**
   * The scope every atom read runs over (latest version per run in window,
   * archived excluded) — written once so the overview and atom list can't
   * scan different row sets.
   */
  static atomScopeSql(filters: AtomFilterSql): string {
    const dedupFilters = `TenantId = {tenantId:String} ${filters.stableClause} ${filters.dedupWindowClause}`;
    return `FROM ${TABLE_NAME}
   WHERE TenantId = {tenantId:String}
     ${filters.stableClause}
     ${filters.volatileClause}
     AND ArchivedAt IS NULL
     AND (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, UpdatedAt) IN (
       SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
       FROM ${TABLE_NAME}
       WHERE ${dedupFilters}
       GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
     )`;
  }

  private constructor(private readonly resolveClient: ResultAtomsClickHouseClientResolver) {
    super();
  }

  private async getClient(tenantId: string): Promise<ResultAtomsClickHouseClient> {
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
    const result = await client.query({ query, query_params: params, format: "JSONEachRow" });
    return result.json<T>();
  }

  /**
   * One page of atoms, newest first, keyset paginated: the cursor walks
   * backwards through the same sort expression, breaking ties on scenario run
   * id so same-millisecond runs can't both sit on a page boundary.
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
    const filters = ResultAtomsClickHouseRepository.buildAtomFilters(filter);
    const decoded = cursor ? decodeCursor(cursor) : null;

    const cursorPredicate = decoded
      ? `AND (
          (${ATOM_SORT_KEY} < toUInt64({atomCursorTs:String}))
          OR (${ATOM_SORT_KEY} = toUInt64({atomCursorTs:String})
              AND ScenarioRunId < {atomCursorRunId:String})
        )`
      : "";

    const rows = await this.queryRows<RawAtomQueryRow>(
      `SELECT
         ScenarioSetId AS SetId,
         BatchRunId,
         ScenarioRunId,
         ScenarioId,
         ${SCENARIO_KEY_EXPR} AS ScenarioKey,
         ifNull(Name, '') AS ScenarioName,
         Status,
         ${OUTCOME_EXPR} AS Outcome,
         toString(${ATOM_SORT_KEY}) AS RunAt,
         ifNull(toString(DurationMs), '') AS DurationMs,
         ${RUN_NOTE_EXPR} AS Note,
         ${TARGET_KEY_EXPR} AS TargetKey,
         ${TARGET_PARAMETERS_EXPR} AS TargetParameters,
         ${CODE_TARGET_NAME_EXPR} AS TargetName,
         ${TRIGGER_EXPR} AS Trigger,
         ${COST_VALUE_EXPR} AS CostUsd,
         ${COST_SOURCE_EXPR} AS CostSource,
         toString(${ATOM_SORT_KEY}) AS SortKey
       ${ResultAtomsClickHouseRepository.atomScopeSql(filters)}
         ${cursorPredicate}
       ORDER BY ${ATOM_SORT_KEY} DESC, ScenarioRunId DESC
       LIMIT {atomLimit:UInt32}`,
      {
        tenantId: filter.projectId,
        ...filters.params,
        ...(decoded ? { atomCursorTs: decoded.ts, atomCursorRunId: decoded.executionId } : {}),
        atomLimit: String(pageSize + 1),
      },
    );

    const hasMore = rows.length > pageSize;
    const page = (hasMore ? rows.slice(0, pageSize) : rows).map((row): RawAtomRow => ({
      ...row,
      Status: mapStatus(row.Status),
    }));
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
   * The run's number within its plan, oldest first, counted over the window
   * (not all time) to match the window-scoped numbers the runs sidebar
   * already draws — read at batch grain since a window holds far fewer runs.
   */
  async findRunOrdinals(filter: ResultsFilter): Promise<RunOrdinalRow[]> {
    if (isEmptyScope(filter)) return [];
    const filters = ResultAtomsClickHouseRepository.buildAtomFilters(filter);
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
         ${ResultAtomsClickHouseRepository.atomScopeSql(filters)}
         GROUP BY ScenarioSetId, BatchRunId
       )`,
      { tenantId: filter.projectId, ...filters.params },
    );
  }

  /** The stat strip counts, over every atom in scope. */
  async tryAggregateTotals(filter: ResultsFilter): Promise<RawTotalsRow | null> {
    if (isEmptyScope(filter)) return null;
    const filters = ResultAtomsClickHouseRepository.buildAtomFilters(filter);
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
         ${ResultAtomsClickHouseRepository.atomScopeSql(filters)}
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
    const filters = ResultAtomsClickHouseRepository.buildAtomFilters(filter);
    return this.queryRows<RawGroupRow>(
      `SELECT
         GroupKey,
         argMax(Name, RunAt)                     AS Name,
         argMax(TargetName, RunAt)               AS TargetName,
         argMax(TargetParameters, RunAt)         AS TargetParameters,
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
           ${ResultAtomsClickHouseRepository.groupKeyExpr(groupBy)} AS GroupKey,
           ifNull(Name, '') AS Name,
           BatchRunId,
           ScenarioId,
           ${TARGET_KEY_EXPR} AS TargetKey,
           ${CODE_TARGET_NAME_EXPR} AS TargetName,
           ${TARGET_PARAMETERS_EXPR} AS TargetParameters,
           ${ATOM_SORT_KEY} AS RunAt,
           ${OUTCOME_EXPR} AS Outcome,
           ${COST_NUMERIC_EXPR} AS CostUsd,
           ${COST_UNKNOWN_EXPR} AS CostUnknown
         ${ResultAtomsClickHouseRepository.atomScopeSql(filters)}
       )
       GROUP BY GroupKey`,
      { tenantId: filter.projectId, ...filters.params },
    );
  }

  /**
   * Code-run scenarios inside the window, one per key under their newest
   * run's name — these have no Postgres row, so the window is the only place
   * to list them, and an unfiltered caller sees the full set.
   */
  async findCodeScenarios(filter: ResultsFilter): Promise<RawCodeScenarioRow[]> {
    if (isEmptyScope(filter)) return [];
    const filters = ResultAtomsClickHouseRepository.buildAtomFilters(filter);
    return this.queryRows<RawCodeScenarioRow>(
      `SELECT
         ScenarioKey,
         argMax(Name, RunAt) AS Name
       FROM (
         SELECT
           ${SCENARIO_KEY_EXPR} AS ScenarioKey,
           ifNull(Name, '') AS Name,
           ${ATOM_SORT_KEY} AS RunAt
         ${ResultAtomsClickHouseRepository.atomScopeSql(filters)}
           AND ${TRIGGER_EXPR} = 'code'
       )
       GROUP BY ScenarioKey
       ORDER BY Name ASC, ScenarioKey ASC
       LIMIT {atomCodeScenarios:UInt32}`,
      {
        tenantId: filter.projectId,
        ...filters.params,
        atomCodeScenarios: String(MAX_CODE_SCENARIOS),
      },
    );
  }

  /**
   * Targets the window names that stored agent/prompt lists cannot: a
   * code-named target under its newest run's name, and a stored target under
   * its reference id and overrides — omitting any already covered elsewhere.
   */
  async findRunTargets(filter: ResultsFilter): Promise<RawRunTargetRow[]> {
    if (isEmptyScope(filter)) return [];
    const filters = ResultAtomsClickHouseRepository.buildAtomFilters(filter);
    return this.queryRows<RawRunTargetRow>(
      `SELECT
         TargetKey,
         argMax(Name, RunAt)             AS Name,
         argMax(ReferenceId, RunAt)      AS ReferenceId,
         argMax(TargetParameters, RunAt) AS TargetParameters
       FROM (
         SELECT
           ${TARGET_KEY_EXPR} AS TargetKey,
           ${CODE_TARGET_NAME_EXPR} AS Name,
           ${TARGET_REF_EXPR} AS ReferenceId,
           ${TARGET_PARAMETERS_EXPR} AS TargetParameters,
           ${ATOM_SORT_KEY} AS RunAt
         ${ResultAtomsClickHouseRepository.atomScopeSql(filters)}
           AND (
             (${TRIGGER_EXPR} = 'code'
               AND ${TARGET_KEY_EXPR} != '${UNKNOWN_TARGET_KEY}')
             OR ${TARGET_PARAMETERS_EXPR} != ''
           )
       )
       GROUP BY TargetKey
       ORDER BY Name ASC, ReferenceId ASC, TargetKey ASC
       LIMIT {atomRunTargets:UInt32}`,
      { tenantId: filter.projectId, ...filters.params, atomRunTargets: String(MAX_RUN_TARGETS) },
    );
  }

  /**
   * Sparkline points per group, trimmed to what a sparkline actually draws —
   * read whole (one aggregate, bounded by run count) and trimmed HERE rather
   * than after, since Results is now the default view. `LIMIT n BY` is safe over this GROUP BY output, not the base table.
   */
  async aggregateTrend({
    filter,
    groupBy,
  }: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<RawTrendRow[]> {
    if (isEmptyScope(filter)) return [];
    const filters = ResultAtomsClickHouseRepository.buildAtomFilters(filter);
    return this.queryRows<RawTrendRow>(
      `SELECT
         GroupKey,
         TrendKey,
         toString(RunAtMs)  AS RunAt,
         toString(Passed)   AS Passed,
         toString(Settled)  AS Settled
       FROM (
         SELECT
           GroupKey,
           TrendKey,
           min(RunAtMs)                   AS RunAtMs,
           countIf(Outcome = 'passed')    AS Passed,
           countIf(Outcome != 'pending')  AS Settled
         FROM (
           SELECT
             ${ResultAtomsClickHouseRepository.groupKeyExpr(groupBy)} AS GroupKey,
             ${ResultAtomsClickHouseRepository.trendKeyExpr(groupBy)} AS TrendKey,
             ${ATOM_SORT_KEY} AS RunAtMs,
             ${OUTCOME_EXPR} AS Outcome
           ${ResultAtomsClickHouseRepository.atomScopeSql(filters)}
         )
         GROUP BY GroupKey, TrendKey
       )
       ORDER BY GroupKey ASC, RunAtMs DESC, TrendKey DESC
       LIMIT {atomTrendPoints:UInt32} BY GroupKey`,
      { tenantId: filter.projectId, ...filters.params, atomTrendPoints: String(MAX_TREND_POINTS) },
    );
  }

  /**
   * Pass rate over time in fixed buckets: empty buckets are absent here and
   * filled in by the caller, so the chart draws a gap rather than a
   * misleading zero (total failure) for periods with no data.
   */
  async aggregateSeries({
    filter,
    bucketSeconds,
  }: {
    filter: ResultsFilter;
    bucketSeconds: number;
  }): Promise<RawSeriesRow[]> {
    if (isEmptyScope(filter)) return [];
    const filters = ResultAtomsClickHouseRepository.buildAtomFilters(filter);
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
         ${ResultAtomsClickHouseRepository.atomScopeSql(filters)}
       )
       GROUP BY Bucket
       ORDER BY Bucket ASC`,
      { tenantId: filter.projectId, ...filters.params, atomBucketSeconds: String(bucketSeconds) },
    );
  }
}

/** Resolves a tenant's own routed ClickHouse client. */
export type ResultAtomsClickHouseClientResolver = (
  tenantId: string,
) => Promise<ResultAtomsClickHouseClient>;
