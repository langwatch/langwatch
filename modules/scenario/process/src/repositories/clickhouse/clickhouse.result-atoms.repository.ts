/**
 * Results tab atom: flat `simulation_runs` for filter/group, distinct from v1 batch/set.
 * SQL builders are static methods per restructure-bug-hunt-2026-09-03.md.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  type Condition,
  type ConditionOps,
  type Expression,
  fn,
  param,
  type ReaderReadStatement,
  type SingleTenantScope,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import {
  MAX_TREND_POINTS,
  MAX_ATOM_PAGE,
  AGENT_TEST_SET_SUFFIX,
  expandSetIdFilter,
  UNKNOWN_TARGET_KEY,
  VOICE_CALL_SCENARIO_SET_ID,
  type ResultsFilter,
  type ResultsGroupBy,
} from "@langwatch/scenario-contract";

import {
  type RawAtomRow,
  type RunOrdinalRow,
  type RawGroupRow,
  type RawTrendRow,
  type RawCodeScenarioRow,
  type RawRunTargetRow,
  type RawSeriesRow,
  type RawTotalsRow,
  ResultAtomsRepository,
} from "../result-atoms.repository.ts";
import { simulationRuns } from "./clickhouse.simulation-runs.table.ts";
import {
  RUN_NOT_SCORED_EXPR,
  RUN_NOTE_EXPR,
  TABLE_NAME,
} from "./simulation-clickhouse.repository.ts";
import { mapStatus } from "./simulation-run.mapper.ts";

/** How many scenarios that ran from code the filter lists at most. */
export const MAX_CODE_SCENARIOS = 500;

/** How many targets the window names beyond the stored lists, at most. */
export const MAX_RUN_TARGETS = 500;

/**
 * Raw `Status` values read as failure: stalled/cancelled count, and
 * `FAILURE` is the legacy spelling `mapStatus` folds into `FAILED`. Pinned
 * against `categorizeRunStatus` by a unit test so SQL and TS can't drift.
 */
export const FAILED_STATUS_VALUES = ["ERROR", "FAILED", "FAILURE", "STALLED", "CANCELLED"] as const;

/** Raw `Status` values that read as a pass. */
export const PASSED_STATUS_VALUES = ["SUCCESS"] as const;

const quoted = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(",");

/** How an atom's status reads: passed, failed, not scored (its setup failed) or still pending. */
const OUTCOME_EXPR = `multiIf(
  Status IN (${quoted(PASSED_STATUS_VALUES)}), 'passed',
  ${RUN_NOT_SCORED_EXPR}, 'not_scored',
  Status IN (${quoted(FAILED_STATUS_VALUES)}), 'failed',
  'pending')`;

/** The outcomes a pass rate divides by: a not-scored run is finished but never graded. */
const GRADED_OUTCOME_VALUES = ["passed", "failed"] as const;
const GRADED_OUTCOMES = `(${quoted(GRADED_OUTCOME_VALUES)})`;

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
const CODE_TARGET_SLUG_EXPR = nameSlug(CODE_TARGET_NAME_EXPR);

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
const TRIGGER_EXPR = `if(${TARGET_REF_EXPR} = '', 'code', 'app')`;

/**
 * The set a run belongs to, the empty id read as `default` the way every
 * other read of a set that runs from code does.
 */
const SET_KEY_EXPR = `if(ScenarioSetId = '', 'default', ScenarioSetId)`;

/** A run's name as a key, so two spellings of one scenario fold together. */
const NAME_SLUG_EXPR = nameSlug("ifNull(Name, '')");

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
const COST_SOURCE_EXPR = `multiIf(
  TotalCost IS NOT NULL, 'run',
  length(${TRACE_METRIC_KEYS}) > 0, 'traces',
  length(TraceIds) = 0, 'none',
  'unknown')`;

/** The atom's cost, as a string, with '' standing for "never measured". */
const COST_VALUE_EXPR = `multiIf(
  TotalCost IS NOT NULL, toString(TotalCost),
  length(${TRACE_METRIC_KEYS}) > 0, toString(${TRACE_COST_SUM}),
  length(TraceIds) = 0, '0',
  '')`;

/** The cost as a number for aggregation, with a never-measured atom as zero. */
const COST_NUMERIC_EXPR = `multiIf(
  TotalCost IS NOT NULL, TotalCost,
  length(${TRACE_METRIC_KEYS}) > 0, ${TRACE_COST_SUM},
  0)`;

/** 1 when the atom's cost was never measured. */
const COST_UNKNOWN_EXPR = `if(${COST_SOURCE_EXPR} = 'unknown', 1, 0)`;

/**
 * `StartedAt` moves (null -> `CreatedAt` -> started event), so a tight
 * range filter can drop the true latest version from its own dedup group.
 * @see dev/docs/best_practices/clickhouse-queries.md — "A range filter on a MOVABLE column"
 */
export const DEDUP_WINDOW_SLACK_MS = 7 * 24 * 60 * 60 * 1000;

interface AtomFilterSql {
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
    // A "Test agent" run is a check of an agent, not a result of a scenario;
    // the legacy `voice-calls` set is a pre-#8020 drawer call, likewise never a
    // scenario result (a drawer call no longer writes a run at all).
    `NOT endsWith(ScenarioSetId, '${AGENT_TEST_SET_SUFFIX}')`,
    `ScenarioSetId != '${VOICE_CALL_SCENARIO_SET_ID}'`,
  ];
  const params: Record<string, string | string[]> = {};

  if (filter.scenarioSetIds && filter.scenarioSetIds.length > 0) {
    parts.push("ScenarioSetId IN ({atomSetIds:Array(String)})");
    params.atomSetIds = filter.scenarioSetIds.flatMap((setId) => expandSetIdFilter(setId));
  }

  return { parts, params };
}

/** The `Status` predicate a verdict filter asks for, if it asks for one. */
function buildOutcomePart(outcome: ResultsFilter["outcome"]): string | null {
  if (outcome === "passed") {
    return `Status IN (${quoted(PASSED_STATUS_VALUES)})`;
  }

  if (outcome === "failed") {
    return `Status IN (${quoted(FAILED_STATUS_VALUES)}) AND NOT ${RUN_NOT_SCORED_EXPR}`;
  }

  if (outcome === "not_scored") {
    return RUN_NOT_SCORED_EXPR;
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

  const outcome = buildOutcomePart(filter.outcome);
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

/** What an aggregate over no atoms counts. */
const EMPTY_TOTALS: RawTotalsRow = {
  Atoms: "0",
  Passed: "0",
  Settled: "0",
  RunCount: "0",
  FailingScenarios: "0",
  CostTotal: "0",
  CostUnknown: "0",
};

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

/**
 * The window's runs at their latest version, as the table the typed atom reads select from. The
 * election repeats only the widened window, so the exact window applies over this table.
 * @see dev/docs/best_practices/clickhouse-queries.md — "A range filter on a MOVABLE column"
 */
function atomRunsOf({ filter, scope }: { filter: ResultsFilter; scope: SingleTenantScope }) {
  const t = simulationRuns;
  const setIds = filter.scenarioSetIds?.flatMap((setId) => expandSetIdFilter(setId)) ?? [];
  const runs = clickhouseRead({ scope })
    .from(t)
    .select({
      ScenarioSetId: t.ScenarioSetId,
      BatchRunId: t.BatchRunId,
      ScenarioRunId: t.ScenarioRunId,
      ScenarioId: t.ScenarioId,
      Name: t.Name,
      Status: t.Status,
      Metadata: t.Metadata,
      StartedAt: t.StartedAt,
      CreatedAt: t.CreatedAt,
    })
    .where(({ and, ne, not, oneOf }) =>
      and(
        ne(t.ScenarioId, ""),
        not(fn.endsWith(t.ScenarioSetId, AGENT_TEST_SET_SUFFIX)),
        ne(t.ScenarioSetId, VOICE_CALL_SCENARIO_SET_ID),
        ...(setIds.length > 0 ? [oneOf(t.ScenarioSetId, setIds)] : []),
      ),
    )
    .where(({ gte }) => gte(t.StartedAt, Math.max(0, filter.startDate - DEDUP_WINDOW_SLACK_MS)));
  const { endDate } = filter;
  const windowed =
    endDate === undefined
      ? runs
      : runs.where(({ lte }) => lte(t.StartedAt, endDate + DEDUP_WINDOW_SLACK_MS));
  return windowed
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion()
    .as("atoms");
}

export type AtomRuns = ReturnType<typeof atomRunsOf>;
export type AtomOps = ConditionOps<"atoms", Record<never, never>>;
type AtomText = Expression<string, "atoms">;

const metadataOf = (atoms: AtomRuns) => fn.ifNull(atoms.Metadata, "{}");
const langwatchOf = (atoms: AtomRuns) => fn.JSONExtractRaw(metadataOf(atoms), "langwatch");

/** The typed reads of a run's fields; each mirrors the text expression of the same name above. */
export const atomFields = {
  sortKey: (atoms: AtomRuns): Expression<number, "atoms"> =>
    fn.toUnixTimestamp64Milli(fn.ifNull(atoms.StartedAt, atoms.CreatedAt)),
  targetRef: (atoms: AtomRuns): AtomText =>
    fn.JSONExtractString(langwatchOf(atoms), "targetReferenceId"),
  targetStampKey: (atoms: AtomRuns): AtomText =>
    fn.JSONExtractString(langwatchOf(atoms), "targetKey"),
  targetParameters: (atoms: AtomRuns): AtomText =>
    fn.JSONExtractRaw(langwatchOf(atoms), "targetParameters"),
  langwatchString: (atoms: AtomRuns, key: string): AtomText =>
    fn.JSONExtractString(langwatchOf(atoms), key),
  metadataRaw: (atoms: AtomRuns, key: string): AtomText =>
    fn.JSONExtractRaw(metadataOf(atoms), key),
  metadataString: (atoms: AtomRuns, key: string): AtomText =>
    fn.JSONExtractString(metadataOf(atoms), key),
  codeTargetName: (atoms: AtomRuns, { and, eq, ne }: AtomOps): AtomText =>
    fn.arrayStringConcat(
      fn.arrayMap(
        (agent) => fn.JSONExtractString(agent, "name"),
        fn.arrayFilter(
          (agent) =>
            and(
              eq(fn.JSONExtractString(agent, "role"), "agent"),
              ne(fn.JSONExtractString(agent, "name"), ""),
            ),
          fn.JSONExtractArrayRaw(metadataOf(atoms), "agents"),
        ),
      ),
      " vs ",
    ),
  targetKey: (atoms: AtomRuns, ops: AtomOps): AtomText => {
    const stamp = atomFields.targetStampKey(atoms);
    const ref = atomFields.targetRef(atoms);
    const slug = nameSlugOf(atomFields.codeTargetName(atoms, ops));
    return fn.multiIf(
      [
        [ops.ne(stamp, ""), stamp],
        [ops.ne(ref, ""), ref],
        [ops.ne(slug, ""), fn.concat("code:", slug)],
      ],
      param.string(UNKNOWN_TARGET_KEY),
    );
  },
  trigger: (atoms: AtomRuns, { eq }: AtomOps): AtomText =>
    fn.if(eq(atomFields.targetRef(atoms), ""), param.string("code"), "app"),
  scenarioKey: (atoms: AtomRuns, { and, eq, ne }: AtomOps): AtomText => {
    const setKey = fn.if(eq(atoms.ScenarioSetId, ""), param.string("default"), atoms.ScenarioSetId);
    const nameSlug = nameSlugOf(fn.ifNull(atoms.Name, ""));
    return fn.if(
      and(eq(atomFields.targetRef(atoms), ""), ne(nameSlug, "")),
      fn.concat(setKey, "-", nameSlug),
      atoms.ScenarioId,
    );
  },
  notScored: (atoms: AtomRuns, { and, eq, not, oneOf }: AtomOps): Condition =>
    and(
      eq(atoms.Status, "ERROR"),
      not(
        oneOf(fn.JSONExtractString(metadataOf(atoms), "langwatch", "hooks", "setup", "status"), [
          "",
          "ok",
        ]),
      ),
    ),
  outcome: (atoms: AtomRuns, ops: AtomOps): AtomText =>
    fn.multiIf(
      [
        [ops.oneOf(atoms.Status, [...PASSED_STATUS_VALUES]), param.string("passed")],
        [atomFields.notScored(atoms, ops), param.string("not_scored")],
        [ops.oneOf(atoms.Status, [...FAILED_STATUS_VALUES]), param.string("failed")],
      ],
      param.string("pending"),
    ),
  groupKey: (groupBy: ResultsGroupBy, atoms: AtomRuns, ops: AtomOps): AtomText => {
    switch (groupBy) {
      case "plan":
        return atoms.ScenarioSetId;
      case "scenario":
        return atomFields.scenarioKey(atoms, ops);
      case "target":
        return atomFields.targetKey(atoms, ops);
      case "none":
        return atoms.ScenarioRunId;
    }
  },
  trendKey: (groupBy: ResultsGroupBy, atoms: AtomRuns): AtomText =>
    groupBy === "plan" ? atoms.BatchRunId : atoms.ScenarioRunId,
} as const;

/** Lower case, each stretch of anything but a letter or digit one dash, no dash at either end. */
function nameSlugOf<T extends string>(of: Expression<string, T>) {
  return fn.trimBoth(fn.replaceRegexpAll(fn.lowerUTF8(of), "[^\\p{L}\\p{N}]+", "-"), "-");
}

/** The predicates only valid after the election: the exact window, outcome, target and scenario. */
function atomsInScope(filter: ResultsFilter, atoms: AtomRuns, ops: AtomOps): Condition {
  const { and, gte, lte, not, oneOf } = ops;
  const parts: Condition[] = [gte(atoms.StartedAt, filter.startDate)];
  if (filter.endDate !== undefined) parts.push(lte(atoms.StartedAt, filter.endDate));
  if (filter.outcome === "passed") parts.push(oneOf(atoms.Status, [...PASSED_STATUS_VALUES]));
  if (filter.outcome === "failed") {
    parts.push(
      and(oneOf(atoms.Status, [...FAILED_STATUS_VALUES]), not(atomFields.notScored(atoms, ops))),
    );
  }
  if (filter.outcome === "not_scored") parts.push(atomFields.notScored(atoms, ops));
  if (filter.outcome === "pending") {
    parts.push(not(oneOf(atoms.Status, [...PASSED_STATUS_VALUES, ...FAILED_STATUS_VALUES])));
  }
  if (filter.targetKeys && filter.targetKeys.length > 0) {
    parts.push(oneOf(atomFields.targetKey(atoms, ops), filter.targetKeys));
  }
  if (filter.scenarioIds && filter.scenarioIds.length > 0) {
    parts.push(oneOf(atomFields.scenarioKey(atoms, ops), filter.scenarioIds));
  }
  return and(...parts);
}

/** The raw ClickHouse row, `Status` unmapped. Internal to this file only. */
type RawAtomQueryRow = Omit<RawAtomRow, "Status"> & { Status: string };

/**
 * Narrow duck-typed slice of `ClickHouseClient` this repository reads
 * through, so the composition root can hand it the same routed-tenant
 * client v1's `SimulationClickHouseClient` already composes, with no cast.
 */
type ResultAtomsClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, string | string[]>;
    format: "JSONEachRow";
  }): Promise<{ json<Result>(): Promise<Result[]> }>;
  /** A statement the typed builder built; the session refuses one scoped to another tenant. */
  read: ClickHouseQueryClient["read"];
};

export class ResultAtomsClickHouseRepository extends ResultAtomsRepository {
  static create(
    resolveClient: ResultAtomsClickHouseClientResolver,
  ): ResultAtomsClickHouseRepository {
    return new ResultAtomsClickHouseRepository(resolveClient);
  }

  /** The atoms in scope as one tenant's read, with the scope its derived tables share. */
  static atomScope(filter: ResultsFilter): { scope: SingleTenantScope; atoms: AtomRuns } {
    const scope = tenantScope.single({ tenantId: filter.projectId });
    return { scope, atoms: atomRunsOf({ filter, scope }) };
  }

  /** The predicates only valid after the election, over the atoms of {@link atomScope}. */
  static inScope(filter: ResultsFilter, atoms: AtomRuns, ops: AtomOps): Condition {
    return atomsInScope(filter, atoms, ops);
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
  async listAtoms({
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
         toString(${ATOM_SORT_KEY}) AS SortKey,
         ` +
        "`Evaluations.EvaluatorId` AS EvaluationIds,\n" +
        "         `Evaluations.Name` AS EvaluationNames,\n" +
        "         `Evaluations.Status` AS EvaluationStatuses,\n" +
        "         `Evaluations.Required` AS EvaluationRequired,\n" +
        "         `Evaluations.Passed` AS EvaluationPassed,\n" +
        "         `Evaluations.Score` AS EvaluationScores,\n" +
        "         `Evaluations.Label` AS EvaluationLabels\n" +
        `
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
    return this.readRows(filter, ResultAtomsClickHouseRepository.runOrdinalsRead(filter));
  }

  /** Each batch's first run in the window, numbered within its plan oldest first. */
  static runOrdinalsRead(filter: ResultsFilter): ReaderReadStatement<RunOrdinalRow> {
    const { scope, atoms } = ResultAtomsClickHouseRepository.atomScope(filter);
    const batches = clickhouseRead({ scope })
      .from(atoms)
      .select({
        SetId: atoms.ScenarioSetId,
        BatchRunId: atoms.BatchRunId,
        RunAt: fn.min(atomFields.sortKey(atoms)),
      })
      .where((ops) => atomsInScope(filter, atoms, ops))
      .groupBy(atoms.ScenarioSetId, atoms.BatchRunId)
      .as("batches");
    return clickhouseRead({ scope })
      .from(batches)
      .select({
        SetId: batches.SetId,
        BatchRunId: batches.BatchRunId,
        RunAt: fn.toString(batches.RunAt),
        Ordinal: fn.toString(
          fn.over(fn.rowNumber(), {
            partitionBy: [batches.SetId],
            orderBy: [
              [batches.RunAt, "ASC"],
              [batches.BatchRunId, "ASC"],
            ],
          }),
        ),
      })
      .build();
  }

  private async readRows<Row>(
    filter: ResultsFilter,
    statement: ReaderReadStatement<Row>,
  ): Promise<Row[]> {
    const client = await this.getClient(filter.projectId);
    const { rows } = await client.read({ statement, table: simulationRuns.$table.name });
    return rows;
  }

  /** The stat strip counts, over every atom in scope. */
  async aggregateTotals(filter: ResultsFilter): Promise<RawTotalsRow> {
    if (isEmptyScope(filter)) return EMPTY_TOTALS;
    const filters = ResultAtomsClickHouseRepository.buildAtomFilters(filter);
    const rows = await this.queryRows<RawTotalsRow>(
      `SELECT
         toString(count())                                        AS Atoms,
         toString(countIf(Outcome = 'passed'))                    AS Passed,
         toString(countIf(Outcome IN ${GRADED_OUTCOMES}))                  AS Settled,
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
    return rows[0] ?? EMPTY_TOTALS;
  }

  /**
   * One row per group, folded in the database so volume never reaches the
   * client. An arrow property, not a method: the base class declares it as
   * a property, and an `extends` member's kind must match its base's.
   */
  aggregateGroups = async ({
    filter,
    groupBy,
  }: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<RawGroupRow[]> => {
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
         toString(countIf(Outcome IN ${GRADED_OUTCOMES})) AS Settled,
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
  };

  /**
   * Code-run scenarios inside the window, one per key under their newest
   * run's name — these have no Postgres row, so the window is the only place
   * to list them, and an unfiltered caller sees the full set.
   */
  async findCodeScenarios(filter: ResultsFilter): Promise<RawCodeScenarioRow[]> {
    if (isEmptyScope(filter)) return [];
    return this.readRows(filter, ResultAtomsClickHouseRepository.codeScenariosRead(filter));
  }

  /** Code-run scenarios in scope, one per key under its newest run's name. */
  static codeScenariosRead(filter: ResultsFilter): ReaderReadStatement<RawCodeScenarioRow> {
    const { scope, atoms } = ResultAtomsClickHouseRepository.atomScope(filter);
    const runs = clickhouseRead({ scope })
      .from(atoms)
      .select((ops) => ({
        ScenarioKey: atomFields.scenarioKey(atoms, ops),
        Name: fn.ifNull(atoms.Name, ""),
        RunAt: atomFields.sortKey(atoms),
      }))
      .where((ops) =>
        ops.and(atomsInScope(filter, atoms, ops), ops.eq(atomFields.trigger(atoms, ops), "code")),
      )
      .as("code_runs");
    // Ordered by the aggregate, not its alias: 26.8 reads the alias as the source's column.
    const name = fn.argMax(runs.Name, runs.RunAt);
    return clickhouseRead({ scope })
      .from(runs)
      .select({ ScenarioKey: runs.ScenarioKey, Name: name })
      .groupBy(runs.ScenarioKey)
      .orderBy(name, "ASC")
      .orderBy("ScenarioKey", "ASC")
      .limit(MAX_CODE_SCENARIOS)
      .build();
  }

  /**
   * Targets the window names that stored agent/prompt lists cannot: a
   * code-named target under its newest run's name, and a stored target under
   * its reference id and overrides — omitting any already covered elsewhere.
   */
  async findRunTargets(filter: ResultsFilter): Promise<RawRunTargetRow[]> {
    if (isEmptyScope(filter)) return [];
    return this.readRows(filter, ResultAtomsClickHouseRepository.runTargetsRead(filter));
  }

  /** Code-named targets and stored targets with overrides, each under its newest run. */
  static runTargetsRead(filter: ResultsFilter): ReaderReadStatement<RawRunTargetRow> {
    const { scope, atoms } = ResultAtomsClickHouseRepository.atomScope(filter);
    const runs = clickhouseRead({ scope })
      .from(atoms)
      .select((ops) => ({
        TargetKey: atomFields.targetKey(atoms, ops),
        Name: atomFields.codeTargetName(atoms, ops),
        ReferenceId: atomFields.targetRef(atoms),
        TargetParameters: atomFields.targetParameters(atoms),
        RunAt: atomFields.sortKey(atoms),
      }))
      .where((ops) =>
        ops.and(
          atomsInScope(filter, atoms, ops),
          ops.or(
            ops.and(
              ops.eq(atomFields.trigger(atoms, ops), "code"),
              ops.ne(atomFields.targetKey(atoms, ops), UNKNOWN_TARGET_KEY),
            ),
            ops.ne(atomFields.targetParameters(atoms), ""),
          ),
        ),
      )
      .as("target_runs");
    // Ordered by the aggregates, not their aliases: 26.8 reads an alias as the source's column.
    const name = fn.argMax(runs.Name, runs.RunAt);
    const referenceId = fn.argMax(runs.ReferenceId, runs.RunAt);
    return clickhouseRead({ scope })
      .from(runs)
      .select({
        TargetKey: runs.TargetKey,
        Name: name,
        ReferenceId: referenceId,
        TargetParameters: fn.argMax(runs.TargetParameters, runs.RunAt),
      })
      .groupBy(runs.TargetKey)
      .orderBy(name, "ASC")
      .orderBy(referenceId, "ASC")
      .orderBy("TargetKey", "ASC")
      .limit(MAX_RUN_TARGETS)
      .build();
  }

  /**
   * Sparkline points trimmed to sparkline needs; read whole and trim since Results is default.
   * `LIMIT n BY` is safe over this GROUP BY output, not the base table.
   */
  async aggregateTrend({
    filter,
    groupBy,
  }: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<RawTrendRow[]> {
    if (isEmptyScope(filter)) return [];
    return this.readRows(filter, ResultAtomsClickHouseRepository.trendRead({ filter, groupBy }));
  }

  /** Each group's newest sparkline points: one per run or per execution, by the grouping. */
  static trendRead({
    filter,
    groupBy,
  }: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): ReaderReadStatement<RawTrendRow> {
    const { scope, atoms } = ResultAtomsClickHouseRepository.atomScope(filter);
    const runs = clickhouseRead({ scope })
      .from(atoms)
      .select((ops) => ({
        GroupKey: atomFields.groupKey(groupBy, atoms, ops),
        TrendKey: atomFields.trendKey(groupBy, atoms),
        RunAtMs: atomFields.sortKey(atoms),
        Outcome: atomFields.outcome(atoms, ops),
      }))
      .where((ops) => atomsInScope(filter, atoms, ops))
      .as("trend_runs");
    const points = clickhouseRead({ scope })
      .from(runs)
      .select(({ eq, oneOf }) => ({
        GroupKey: runs.GroupKey,
        TrendKey: runs.TrendKey,
        RunAtMs: fn.min(runs.RunAtMs),
        Passed: fn.countIf(eq(runs.Outcome, "passed")),
        Settled: fn.countIf(oneOf(runs.Outcome, [...GRADED_OUTCOME_VALUES])),
      }))
      .groupBy(runs.GroupKey, runs.TrendKey)
      .as("trend_points");
    return clickhouseRead({ scope })
      .from(points)
      .select({
        GroupKey: points.GroupKey,
        TrendKey: points.TrendKey,
        RunAt: fn.toString(points.RunAtMs),
        Passed: fn.toString(points.Passed),
        Settled: fn.toString(points.Settled),
      })
      .orderBy(points.GroupKey, "ASC")
      .orderBy(points.RunAtMs, "DESC")
      .orderBy(points.TrendKey, "DESC")
      .limitBy(MAX_TREND_POINTS, points.GroupKey)
      .build();
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
    return this.readRows(
      filter,
      ResultAtomsClickHouseRepository.seriesRead({ filter, bucketSeconds }),
    );
  }

  /** Passed and graded counts per fixed bucket; a bucket with no atoms is absent. */
  static seriesRead({
    filter,
    bucketSeconds,
  }: {
    filter: ResultsFilter;
    bucketSeconds: number;
  }): ReaderReadStatement<RawSeriesRow> {
    const { scope, atoms } = ResultAtomsClickHouseRepository.atomScope(filter);
    const runs = clickhouseRead({ scope })
      .from(atoms)
      .select((ops) => ({
        Bucket: fn.toStartOfInterval(fn.ifNull(atoms.StartedAt, atoms.CreatedAt), {
          seconds: bucketSeconds,
        }),
        Outcome: atomFields.outcome(atoms, ops),
      }))
      .where((ops) => atomsInScope(filter, atoms, ops))
      .as("series_runs");
    return clickhouseRead({ scope })
      .from(runs)
      .select(({ eq, oneOf }) => ({
        Bucket: fn.toString(fn.multiply(fn.toUnixTimestamp(runs.Bucket), 1000)),
        Passed: fn.toString(fn.countIf(eq(runs.Outcome, "passed"))),
        Settled: fn.toString(fn.countIf(oneOf(runs.Outcome, [...GRADED_OUTCOME_VALUES]))),
      }))
      .groupBy(runs.Bucket)
      .orderBy(runs.Bucket, "ASC")
      .build();
  }
}

/** Resolves a tenant's own routed ClickHouse client. */
export type ResultAtomsClickHouseClientResolver = (
  tenantId: string,
) => Promise<ResultAtomsClickHouseClient>;
