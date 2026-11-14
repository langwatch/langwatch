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

/** The outcomes a pass rate divides by: a not-scored run is finished but never graded. */
const GRADED_OUTCOME_VALUES = ["passed", "failed"] as const;

/**
 * `StartedAt` moves (null -> `CreatedAt` -> started event), so a tight
 * range filter can drop the true latest version from its own dedup group.
 * @see dev/docs/best_practices/clickhouse-queries.md — "A range filter on a MOVABLE column"
 */
export const DEDUP_WINDOW_SLACK_MS = 7 * 24 * 60 * 60 * 1000;

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
 * election repeats the widened window and the ScenarioSetId terms (a run never changes set), so
 * the exact window applies over this table.
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
      DurationMs: t.DurationMs,
      TotalCost: t.TotalCost,
      TraceIds: t.TraceIds,
      TraceMetricsJson: t.TraceMetricsJson,
      evaluationIds: t["Evaluations.EvaluatorId"],
      evaluationNames: t["Evaluations.Name"],
      evaluationStatuses: t["Evaluations.Status"],
      evaluationRequired: t["Evaluations.Required"],
      evaluationPassed: t["Evaluations.Passed"],
      evaluationScores: t["Evaluations.Score"],
      evaluationLabels: t["Evaluations.Label"],
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
    .latestVersion({ repeat: [t.ScenarioSetId] })
    .as("atoms");
}

export type AtomRuns = ReturnType<typeof atomRunsOf>;
export type AtomOps = ConditionOps<"atoms", Record<never, never>>;
type AtomText = Expression<string, "atoms">;

const metadataOf = (atoms: AtomRuns) => fn.ifNull(atoms.Metadata, "{}");
const langwatchOf = (atoms: AtomRuns) => fn.JSONExtractRaw(metadataOf(atoms), "langwatch");

/** The typed reads of a run's fields, shared by every atom read. */
export const atomFields = {
  /**
   * Per-trace costs summed from `TraceMetricsJson` (keyed by trace id, so already distinct), not
   * from `TraceIds`, which held ~3x as many entries as distinct traces and would triple the cost.
   */
  traceCostSum: (atoms: AtomRuns): Expression<number, "atoms"> =>
    fn.arraySum(
      fn.arrayMap(
        (traceKey) =>
          fn.JSONExtractFloat(fn.JSONExtractRaw(atoms.TraceMetricsJson, traceKey), "totalCost"),
        fn.JSONExtractKeys(atoms.TraceMetricsJson),
      ),
    ),
  hasTraceMetrics: (atoms: AtomRuns, { gt }: AtomOps): Condition =>
    gt(fn.length(fn.JSONExtractKeys(atoms.TraceMetricsJson)), 0),
  /** Ordered so a NULL `TotalCost` (traces summed to zero) is told apart from never measured. */
  costSource: (atoms: AtomRuns, ops: AtomOps): AtomText =>
    fn.multiIf(
      [
        [ops.isNotNull(atoms.TotalCost), param.string("run")],
        [atomFields.hasTraceMetrics(atoms, ops), param.string("traces")],
        [ops.eq(fn.length(atoms.TraceIds), 0), param.string("none")],
      ],
      param.string("unknown"),
    ),
  /** The atom's cost as a string, '' standing for "never measured". */
  costValue: (atoms: AtomRuns, ops: AtomOps): AtomText =>
    fn.multiIf(
      [
        [ops.isNotNull(atoms.TotalCost), fn.toString(atoms.TotalCost)],
        [atomFields.hasTraceMetrics(atoms, ops), fn.toString(atomFields.traceCostSum(atoms))],
        [ops.eq(fn.length(atoms.TraceIds), 0), param.string("0")],
      ],
      param.string(""),
    ),
  /** The cost as a number for aggregation, a never-measured atom as zero. */
  costNumeric: (atoms: AtomRuns, ops: AtomOps): Expression<number, "atoms"> =>
    fn.multiIf(
      [
        [ops.isNotNull(atoms.TotalCost), fn.assumeNotNull(atoms.TotalCost)],
        [atomFields.hasTraceMetrics(atoms, ops), atomFields.traceCostSum(atoms)],
      ],
      param.float64(0),
    ),
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

/** A keyset position: the sort key of the last atom shown and its run id, breaking ties. */
type AtomPagePosition = { ts: string; executionId: string };

/** A row of {@link ResultAtomsClickHouseRepository.atomPageRead}, `Status` unmapped. */
type AtomPageRow =
  ReturnType<typeof atomPageReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

/** A row of {@link ResultAtomsClickHouseRepository.groupsRead}. */
type AtomGroupRow =
  ReturnType<typeof groupsReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

function atomPageReadOf({
  filter,
  limit,
  after,
}: {
  filter: ResultsFilter;
  limit: number;
  after: AtomPagePosition | null;
}) {
  const scope = tenantScope.single({ tenantId: filter.projectId });
  const atoms = atomRunsOf({ filter, scope });
  const sortKey = atomFields.sortKey(atoms);
  return clickhouseRead({ scope })
    .from(atoms)
    .select((ops) => ({
      SetId: atoms.ScenarioSetId,
      BatchRunId: atoms.BatchRunId,
      ScenarioRunId: atoms.ScenarioRunId,
      ScenarioId: atoms.ScenarioId,
      ScenarioKey: atomFields.scenarioKey(atoms, ops),
      ScenarioName: fn.ifNull(atoms.Name, ""),
      Status: atoms.Status,
      Outcome: atomFields.outcome(atoms, ops),
      RunAt: fn.toString(sortKey),
      durationText: fn.ifNull(fn.toString(atoms.DurationMs), ""),
      Note: atomFields.metadataString(atoms, "note"),
      TargetKey: atomFields.targetKey(atoms, ops),
      TargetParameters: atomFields.targetParameters(atoms),
      TargetName: atomFields.codeTargetName(atoms, ops),
      Trigger: atomFields.trigger(atoms, ops),
      CostUsd: atomFields.costValue(atoms, ops),
      CostSource: atomFields.costSource(atoms, ops),
      SortKey: fn.toString(sortKey),
      EvaluationIds: atoms.evaluationIds,
      EvaluationNames: atoms.evaluationNames,
      EvaluationStatuses: atoms.evaluationStatuses,
      EvaluationRequired: atoms.evaluationRequired,
      EvaluationPassed: atoms.evaluationPassed,
      EvaluationScores: atoms.evaluationScores,
      EvaluationLabels: atoms.evaluationLabels,
    }))
    .where((ops) => {
      const inScope = atomsInScope(filter, atoms, ops);
      if (after === null) return inScope;
      const ts = Number(after.ts);
      return ops.and(
        inScope,
        ops.or(
          ops.lt(sortKey, ts),
          ops.and(ops.eq(sortKey, ts), ops.lt(atoms.ScenarioRunId, after.executionId)),
        ),
      );
    })
    .orderBy(sortKey, "DESC")
    .orderBy(atoms.ScenarioRunId, "DESC")
    .limit(limit)
    .build();
}

function mapAtomPageRow(row: AtomPageRow): RawAtomRow {
  return {
    SetId: row.SetId,
    BatchRunId: row.BatchRunId,
    ScenarioRunId: row.ScenarioRunId,
    ScenarioId: row.ScenarioId,
    ScenarioKey: row.ScenarioKey,
    ScenarioName: row.ScenarioName,
    Status: mapStatus(row.Status),
    Outcome: row.Outcome,
    RunAt: row.RunAt,
    DurationMs: row.durationText,
    Note: row.Note,
    TargetKey: row.TargetKey,
    TargetParameters: row.TargetParameters,
    TargetName: row.TargetName,
    Trigger: row.Trigger,
    CostUsd: row.CostUsd,
    CostSource: row.CostSource,
    SortKey: row.SortKey,
    EvaluationIds: [...row.EvaluationIds],
    EvaluationNames: [...row.EvaluationNames],
    EvaluationStatuses: [...row.EvaluationStatuses],
    EvaluationRequired: [...row.EvaluationRequired],
    EvaluationPassed: [...row.EvaluationPassed],
    EvaluationScores: [...row.EvaluationScores],
    EvaluationLabels: [...row.EvaluationLabels],
  };
}

/** Each atom in scope with what the stat strip and the groups count. */
function countedRunsOf({ filter, groupBy }: { filter: ResultsFilter; groupBy: ResultsGroupBy }) {
  const scope = tenantScope.single({ tenantId: filter.projectId });
  const atoms = atomRunsOf({ filter, scope });
  const runs = clickhouseRead({ scope })
    .from(atoms)
    .select((ops) => ({
      GroupKey: atomFields.groupKey(groupBy, atoms, ops),
      RunName: fn.ifNull(atoms.Name, ""),
      BatchRunId: atoms.BatchRunId,
      ScenarioId: atoms.ScenarioId,
      TargetKey: atomFields.targetKey(atoms, ops),
      TargetName: atomFields.codeTargetName(atoms, ops),
      TargetParameters: atomFields.targetParameters(atoms),
      RunAt: atomFields.sortKey(atoms),
      Outcome: atomFields.outcome(atoms, ops),
      CostUsd: atomFields.costNumeric(atoms, ops),
      CostSource: atomFields.costSource(atoms, ops),
    }))
    .where((ops) => atomsInScope(filter, atoms, ops))
    .as("counted_runs");
  return { scope, runs };
}

function totalsReadOf(filter: ResultsFilter) {
  const { scope, runs } = countedRunsOf({ filter, groupBy: "none" });
  return clickhouseRead({ scope })
    .from(runs)
    .select(({ eq, oneOf }) => ({
      Atoms: fn.toString(fn.count()),
      Passed: fn.toString(fn.countIf(eq(runs.Outcome, "passed"))),
      Settled: fn.toString(fn.countIf(oneOf(runs.Outcome, [...GRADED_OUTCOME_VALUES]))),
      RunCount: fn.toString(fn.uniqExact(runs.BatchRunId)),
      FailingScenarios: fn.toString(fn.uniqExactIf(runs.ScenarioId, eq(runs.Outcome, "failed"))),
      CostTotal: fn.toString(fn.sum(runs.CostUsd)),
      CostUnknown: fn.toString(fn.countIf(eq(runs.CostSource, "unknown"))),
    }))
    .build();
}

function groupsReadOf({ filter, groupBy }: { filter: ResultsFilter; groupBy: ResultsGroupBy }) {
  const { scope, runs } = countedRunsOf({ filter, groupBy });
  return clickhouseRead({ scope })
    .from(runs)
    .select(({ eq, oneOf }) => ({
      GroupKey: runs.GroupKey,
      Name: fn.argMax(runs.RunName, runs.RunAt),
      TargetName: fn.argMax(runs.TargetName, runs.RunAt),
      TargetParameters: fn.argMax(runs.TargetParameters, runs.RunAt),
      Atoms: fn.toString(fn.count()),
      Passed: fn.toString(fn.countIf(eq(runs.Outcome, "passed"))),
      Settled: fn.toString(fn.countIf(oneOf(runs.Outcome, [...GRADED_OUTCOME_VALUES]))),
      RunCount: fn.toString(fn.uniqExact(runs.BatchRunId)),
      ScenarioCount: fn.toString(fn.uniqExact(runs.ScenarioId)),
      LastRunAt: fn.toString(fn.max(runs.RunAt)),
      TargetKeys: fn.arraySort(fn.groupUniqArray(runs.TargetKey)),
      CostTotal: fn.toString(fn.sum(runs.CostUsd)),
      CostUnknown: fn.toString(fn.countIf(eq(runs.CostSource, "unknown"))),
    }))
    .groupBy(runs.GroupKey)
    .build();
}

/** The slice of the routed tenant client this repository reads through. */
type ResultAtomsClickHouseClient = {
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

  private constructor(private readonly resolveClient: ResultAtomsClickHouseClientResolver) {
    super();
  }

  private async getClient(tenantId: string): Promise<ResultAtomsClickHouseClient> {
    if (!tenantId) {
      throw new Error("tenantId is required for ClickHouse client resolution");
    }

    return this.resolveClient(tenantId);
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
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = await this.readRows(
      filter,
      ResultAtomsClickHouseRepository.atomPageRead({ filter, limit: pageSize + 1, after }),
    );

    const hasMore = rows.length > pageSize;
    const page = (hasMore ? rows.slice(0, pageSize) : rows).map(mapAtomPageRow);
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

  /** Up to `limit` atoms in scope, newest first, after `after` when one is given. */
  static atomPageRead(input: {
    filter: ResultsFilter;
    limit: number;
    after: AtomPagePosition | null;
  }): ReaderReadStatement<AtomPageRow> {
    return atomPageReadOf(input);
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
    const rows = await this.readRows(filter, ResultAtomsClickHouseRepository.totalsRead(filter));
    return rows[0] ?? EMPTY_TOTALS;
  }

  /** The stat strip counts as one row. */
  static totalsRead(filter: ResultsFilter): ReaderReadStatement<RawTotalsRow> {
    return totalsReadOf(filter);
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
    const rows = await this.readRows(
      filter,
      ResultAtomsClickHouseRepository.groupsRead({ filter, groupBy }),
    );
    return rows.map((row) => ({ ...row, TargetKeys: [...row.TargetKeys] }));
  };

  /** One row per group, its name and target from the group's newest run. */
  static groupsRead(input: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): ReaderReadStatement<AtomGroupRow> {
    return groupsReadOf(input);
  }

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
