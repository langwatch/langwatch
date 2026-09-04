import { AGENT_TEST_SET_SUFFIX } from "~/server/scenarios/agent-test-scenario";
import { expandSetIdFilter } from "~/server/scenarios/internal-set-id";
import { TABLE_NAME } from "../repositories/simulation.clickhouse.repository";
import type { ResultsFilter, ResultsGroupBy } from "./atom.types";
import { UNKNOWN_TARGET_KEY } from "./atom.types";

/**
 * Raw `Status` values that read as a failure.
 *
 * A stalled or a cancelled run counts as a failure, the way the rest of the
 * product counts it: it was asked for and it did not pass. `FAILURE` is the
 * legacy spelling that `mapStatus` folds into `FAILED`, so it has to appear
 * here or old rows would read as pending.
 *
 * The list is pinned against `categorizeRunStatus` by a unit test, so the SQL
 * and the TypeScript cannot drift into disagreeing about a verdict.
 */
export const FAILED_STATUS_VALUES = [
  "ERROR",
  "FAILED",
  "FAILURE",
  "STALLED",
  "CANCELLED",
] as const;

/** Raw `Status` values that read as a pass. */
export const PASSED_STATUS_VALUES = ["SUCCESS"] as const;

const quoted = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(",");

/** How an atom's status reads: passed, failed or still pending. */
export const OUTCOME_EXPR = `multiIf(
  Status IN (${quoted(PASSED_STATUS_VALUES)}), 'passed',
  Status IN (${quoted(FAILED_STATUS_VALUES)}), 'failed',
  'pending')`;

/**
 * When the run started, epoch ms.
 *
 * ORDER BY, the cursor predicate and the value handed back as the cursor must
 * all be this one expression. `StartedAt` is nullable on a run the projection
 * opened before its started event landed, and ClickHouse sorts NULLs first, so
 * coalescing here is what stops those rows piling onto page one and becoming
 * unreachable for the rest of the sweep.
 */
export const ATOM_SORT_KEY =
  "toUnixTimestamp64Milli(ifNull(StartedAt, CreatedAt))";

/**
 * The reserved namespace the platform stamps onto a run's metadata.
 *
 * Everything the platform knows about a run and did not get from the SDK sits
 * under this one key, so a customer key can never collide with it.
 */
export const LANGWATCH_METADATA =
  "JSONExtractRaw(ifNull(Metadata, '{}'), 'langwatch')";

/**
 * The target a run was pointed at, as the bare reference id.
 *
 * The platform stamps it into a reserved `langwatch` namespace on the run
 * metadata; an SDK or CI push carries none. The client already names a
 * reference id through its own target map, so nothing here resolves names.
 */
export const TARGET_REF_EXPR = `JSONExtractString(${LANGWATCH_METADATA}, 'targetReferenceId')`;

/**
 * The target key the platform stamped on the run: the reference id alone, or
 * the reference id and a hash of the target's parameter overrides. Empty on
 * a run recorded before targets carried parameters, and on every run pushed
 * from code.
 *
 * @see server/suites/target-key.ts
 */
export const TARGET_STAMP_KEY_EXPR = `JSONExtractString(${LANGWATCH_METADATA}, 'targetKey')`;

/**
 * The parameter overrides of the run's target alone, as the raw JSON object
 * they were stamped as, or '' when the target carried none.
 *
 * Raw rather than a map read: the values are strings, numbers and booleans,
 * and re-typing them in SQL would lose which they were.
 */
export const TARGET_PARAMETERS_EXPR = `JSONExtractRaw(${LANGWATCH_METADATA}, 'targetParameters')`;

/**
 * The names the code that pushed the run reported for its agents, joined.
 *
 * The SDK lists every participant of the run on `metadata.agents`, each with a
 * role. Only the `agent` role names what the run was pointed at: the user
 * simulator and the judge drive the run, they are not what it tests. Two
 * agents in one run read the way the plan table already reads two targets.
 *
 * Empty when the run reported no agent, which is every run pushed by an older
 * SDK.
 */
export const CODE_TARGET_NAME_EXPR = `arrayStringConcat(
  arrayMap(agent -> JSONExtractString(agent, 'name'),
    arrayFilter(agent ->
      JSONExtractString(agent, 'role') = 'agent'
      AND JSONExtractString(agent, 'name') != '',
      JSONExtractArrayRaw(ifNull(Metadata, '{}'), 'agents'))),
  ' vs ')`;

/** The reported agent names as a key, folded the way a scenario name is. */
export const CODE_TARGET_SLUG_EXPR = nameSlug(CODE_TARGET_NAME_EXPR);

/**
 * The key a target folds under.
 *
 * A run started on the platform carries the key the platform stamped, which
 * tells one agent's parameter variants apart. A run recorded before that
 * stamp existed names only its stored agent or prompt, and that reference id
 * is the key, so every key that existed before is unchanged. A run pushed
 * from code names its own agent instead, so its key is built from that name:
 * `code:acme-support-agent`. Two runs of one agent therefore read as one
 * target. A run that names none of these keeps the `unknown` key, which the
 * page reads as the default target.
 */
export const TARGET_KEY_EXPR = `multiIf(
  ${TARGET_STAMP_KEY_EXPR} != '', ${TARGET_STAMP_KEY_EXPR},
  ${TARGET_REF_EXPR} != '', ${TARGET_REF_EXPR},
  ${CODE_TARGET_SLUG_EXPR} != '', concat('code:', ${CODE_TARGET_SLUG_EXPR}),
  '${UNKNOWN_TARGET_KEY}')`;

/**
 * What started the run.
 *
 * There is no trigger column. A platform run always stamps a target, through
 * both the one-off path and the suite path, and an SDK or CI push never does,
 * so the presence of the target IS the signal. It costs nothing extra because
 * the target is already extracted for the target key.
 */
export const TRIGGER_EXPR = `if(${TARGET_REF_EXPR} = '', 'code', 'app')`;

/**
 * The set a run belongs to, the empty id read as `default` the way every
 * other read of a set that runs from code does.
 */
export const SET_KEY_EXPR = `if(ScenarioSetId = '', 'default', ScenarioSetId)`;

/**
 * Any name as a key: lower case, every stretch of anything but a letter or a
 * digit folded to one dash, no dash at either end. "List agents" and
 * "list-agents" fold to one key.
 */
function nameSlug(expr: string): string {
  return `trim(BOTH '-' FROM replaceRegexpAll(lowerUTF8(${expr}), '[^\\p{L}\\p{N}]+', '-'))`;
}

/** A run's name as a key, so two spellings of one scenario fold together. */
export const NAME_SLUG_EXPR = nameSlug("ifNull(Name, '')");

/**
 * The key a scenario folds under.
 *
 * A run started on the platform names a stored scenario, and that id is the
 * key. A run pushed from code carries an id the SDK made up for that one run
 * unless the code set one, so two runs of one scenario would never fold on it;
 * its key is built from its set and its name instead, the id the SDK would
 * have derived: `german-list-agents`. A code run with no name keeps its id,
 * since there is nothing else to fold it on.
 *
 * The filter on scenarios reads this same key, so an opened row asks for the
 * runs it shows and a stored scenario is still found by its id.
 */
export const SCENARIO_KEY_EXPR = `if(${TARGET_REF_EXPR} = '' AND ${NAME_SLUG_EXPR} != '', concat(${SET_KEY_EXPR}, '-', ${NAME_SLUG_EXPR}), ScenarioId)`;

const TRACE_METRIC_KEYS = "JSONExtractKeys(TraceMetricsJson)";

/**
 * The per-trace costs the fold stored on the run, summed.
 *
 * `TraceMetricsJson` is a map keyed by trace id, so its keys are already
 * distinct. That matters: the `TraceIds` array is NOT distinct — on local data
 * it held 1,450 entries over 493 distinct traces — so summing over that column
 * instead would report roughly three times the real cost.
 */
const TRACE_COST_SUM = `arraySum(arrayMap(
  traceKey -> JSONExtractFloat(JSONExtractRaw(TraceMetricsJson, traceKey), 'totalCost'),
  ${TRACE_METRIC_KEYS}))`;

/**
 * Where the atom's cost comes from. See `AtomCostSource` for what each means.
 *
 * The order is what makes the answer correct. The fold writes `TotalCost` as
 * NULL when the traces sum to zero, so a NULL alone cannot tell a run that was
 * measured and cost nothing from one that was never measured at all. Reading
 * the per-trace map next separates the two: on local data it resolves 260 of
 * the 309 NULL rows, leaving 14 of 527 atoms genuinely unmeasured instead of
 * 309. Summing `TotalCost` on its own is the shape that silently under-reports.
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

/** The column a grouping folds on. */
export function groupKeyExpr(groupBy: ResultsGroupBy): string {
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
 * The grain of one sparkline bar.
 *
 * A run plan row covers many scenarios, so a single scenario's verdict says
 * nothing about it and the bar folds a whole run. A scenario row or a target
 * row already names one thing, so each bar is one execution of it.
 */
export function trendKeyExpr(groupBy: ResultsGroupBy): string {
  return groupBy === "plan" ? "BatchRunId" : "ScenarioRunId";
}

/**
 * How far the dedup subquery's partition predicate reaches past the window.
 *
 * `StartedAt` is not immutable across a run's versions: the projection opens a
 * run with `StartedAt` null, persisted as `CreatedAt`, and overwrites it when
 * the started event lands. Range-filtering the `max(UpdatedAt)` scope on a
 * column that moves can drop the true latest version out of its own dedup
 * group, which resolves the group to a stale in-window version — non-null,
 * plausible, and caught by nothing.
 *
 * Leaving the column out of the subquery entirely, the way the export sweep
 * does, is always correct but stops the subquery pruning partitions at all,
 * which for a read that re-runs on every filter change is a whole-history scan.
 * The slack is the middle: the two timestamps are the same moment give or take
 * the delay between an insert and its started event, seconds at worst, so a
 * week on each side cannot exclude the winning version while still pruning
 * every partition outside the window and its margin.
 *
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
   * Predicates that may only be applied AFTER dedup, because the column they
   * read can differ between versions of one run. `Status` is the clearest case:
   * filtering versions by it would resolve a finished run to whichever old
   * version still said "running".
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
    params.atomSetIds = filter.scenarioSetIds.flatMap((setId) =>
      expandSetIdFilter(setId),
    );
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
  const parts = [
    "StartedAt >= fromUnixTimestamp64Milli(toUInt64({atomStartMs:String}))",
  ];
  if (filter.endDate !== undefined) {
    params.atomEndMs = String(filter.endDate);
    parts.push(
      "StartedAt <= fromUnixTimestamp64Milli(toUInt64({atomEndMs:String}))",
    );
  }

  const outcome = outcomePart(filter.outcome);
  if (outcome !== null) parts.push(outcome);

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
    atomDedupStartMs: String(
      Math.max(0, filter.startDate - DEDUP_WINDOW_SLACK_MS),
    ),
  };
  const parts = [
    "StartedAt >= fromUnixTimestamp64Milli(toUInt64({atomDedupStartMs:String}))",
  ];
  if (filter.endDate !== undefined) {
    params.atomDedupEndMs = String(filter.endDate + DEDUP_WINDOW_SLACK_MS);
    parts.push(
      "StartedAt <= fromUnixTimestamp64Milli(toUInt64({atomDedupEndMs:String}))",
    );
  }
  return { parts, params };
}

/** The predicates as one appendable fragment, or nothing when there are none. */
function andClause(parts: string[]): string {
  return parts.length > 0 ? `AND ${parts.join(" AND ")}` : "";
}

/**
 * Builds the WHERE fragments both reads share, split by where each may go.
 *
 * One builder on purpose: the overview and the atom list must never disagree
 * about what is in scope, and two copies of this logic is how they would.
 */
export function buildAtomFilters(filter: ResultsFilter): AtomFilterSql {
  const stable = stableFilterParts(filter);
  const volatilePredicates = volatileFilterParts(filter);
  const dedupWindow = dedupWindowParts(filter);

  return {
    stableClause: andClause(stable.parts),
    volatileClause: andClause(volatilePredicates.parts),
    dedupWindowClause: andClause(dedupWindow.parts),
    params: {
      ...stable.params,
      ...volatilePredicates.params,
      ...dedupWindow.params,
    },
  };
}

/**
 * The scope every atom read runs over: the latest version of each run in the
 * window, archived runs left out.
 *
 * Written once and reused so the overview and the atom list cannot end up
 * scanning different sets of rows.
 */
export function atomScopeSql(filters: AtomFilterSql): string {
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
