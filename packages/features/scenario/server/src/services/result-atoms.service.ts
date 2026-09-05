import {
  isOnPlatformSet,
  ON_PLATFORM_DISPLAY_NAME,
  DEFAULT_SET_ID,
  parseRunParametersJson,
  type AtomCost,
  type AtomCostSource,
  type AtomOutcome,
  type CodeScenario,
  type ResultAtom,
  type ResultGroup,
  type ResultsFilter,
  type ResultsGroupBy,
  type ResultsOverview,
  type RunParameterValues,
  type RunTarget,
  type SeriesBucket,
  type TrendPoint,
} from "@langwatch/scenario-contract";
import { getSuiteSetId, tryExtractSuiteId } from "@langwatch/suite-contract";
import {
  MAX_TREND_POINTS,
  type RawAtomRow,
  type RawGroupRow,
  type RawTrendRow,
  type ResultAtomsReadPort,
} from "../ports/result-atoms-read.port";
import type { ScenarioRepository } from "../repositories/scenario.repository";

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

/**
 * Reads results as atoms and folds them the four ways the Results tab
 * groups — server-side, since a suite of 50 scenarios x 2 targets on every
 * merge produces ~60,000 atoms (~27 MB JSON) in 30 days; the atom list is a bounded drill-down, not what the page adds up.
 */
export class ResultAtomsService {
  static create(
    repository: ResultAtomsReadPort,
    scenarios: ScenarioRepository,
  ): ResultAtomsService {
    return new ResultAtomsService(repository, scenarios);
  }

  private constructor(
    private readonly repository: ResultAtomsReadPort,
    private readonly scenarios: ScenarioRepository,
  ) {}

  /**
   * How wide one bucket of the pass-rate chart is, from the window's width.
   * A fixed bucket count would make a one-day window draw 30 buckets of 48
   * minutes, reading as precision the data doesn't have; anchoring on time keeps a bucket a unit a person recognises.
   */
  static bucketSecondsFor({ startDate, endDate }: { startDate: number; endDate: number }): number {
    const days = (endDate - startDate) / (DAY_SECONDS * 1000);

    if (days <= 2) {
      return HOUR_SECONDS;
    }

    if (days <= 60) {
      return DAY_SECONDS;
    }

    return 7 * DAY_SECONDS;
  }

  /** One page of atoms, newest first. For a drill-down, never for a total. */
  async getAtoms({
    filter,
    limit,
    cursor,
  }: {
    filter: ResultsFilter;
    limit: number;
    cursor?: string;
  }): Promise<{ atoms: ResultAtom[]; nextCursor?: string; hasMore: boolean }> {
    const scopedFilter = await this.resolveScenarioScope(filter);
    const [page, ordinals, plans] = await Promise.all([
      this.repository.findAtoms({ filter: scopedFilter, limit, cursor }),
      this.repository.findRunOrdinals(scopedFilter),
      this.readPlans(scopedFilter.projectId),
    ]);

    const ordinalByRun = new Map(
      ordinals.map((row) => [runKey(row.SetId, row.BatchRunId), Number(row.Ordinal)]),
    );

    return {
      atoms: page.atoms.map((row) => toAtom({ row, ordinalByRun, plans: plans.bySetId })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  /**
   * The scenarios that ran from code inside the window, for the scenario
   * filter. Read over the window alone: a scenario filter already in force
   * must not hide the options that undo it.
   */
  async getCodeScenarios({
    projectId,
    startDate,
    endDate,
  }: {
    projectId: string;
    startDate: number;
    endDate?: number;
  }): Promise<CodeScenario[]> {
    const rows = await this.repository.findCodeScenarios({ projectId, startDate, endDate });

    return rows.map((row) => ({
      key: row.ScenarioKey,
      name: row.Name !== "" ? row.Name : row.ScenarioKey,
    }));
  }

  /**
   * Targets the window names that stored lists cannot, for the target
   * filter: those named by a code-run, and parameter variants of stored
   * targets — read over the window alone, for the same reason code-run scenarios are.
   */
  async getRunTargets({
    projectId,
    startDate,
    endDate,
  }: {
    projectId: string;
    startDate: number;
    endDate?: number;
  }): Promise<RunTarget[]> {
    const rows = await this.repository.findRunTargets({ projectId, startDate, endDate });

    return rows.map((row) => ({
      key: row.TargetKey,
      referenceId: row.ReferenceId === "" ? null : row.ReferenceId,
      parameters: targetParametersOf(row.TargetParameters),
      name: row.Name !== "" ? row.Name : row.TargetKey,
    }));
  }

  /** The stat strip and the group rows, both cut by the same filter. */
  async getOverview({
    filter,
    groupBy,
  }: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<ResultsOverview> {
    const scopedFilter = await this.resolveScenarioScope(filter);
    const endDate = scopedFilter.endDate ?? Date.now();
    const bucketSeconds = ResultAtomsService.bucketSecondsFor({
      startDate: scopedFilter.startDate,
      endDate,
    });

    const [totalsRow, groupRows, trendRows, seriesRows, plans] = await Promise.all([
      this.repository.aggregateTotals(scopedFilter),
      this.repository.aggregateGroups({ filter: scopedFilter, groupBy }),
      this.repository.aggregateTrend({ filter: scopedFilter, groupBy }),
      this.repository.aggregateSeries({ filter: scopedFilter, bucketSeconds }),
      this.readPlans(scopedFilter.projectId),
    ]);

    const trendByGroup = foldTrend(trendRows);
    const titles = await this.readGroupTitles({
      projectId: scopedFilter.projectId,
      groupBy,
      groupRows,
      plans,
    });

    const groups = groupRows.map((row) =>
      toGroup({ row, groupBy, trend: trendByGroup.get(row.GroupKey) ?? [], titles }),
    );

    return {
      totals: {
        executions: Number(totalsRow?.Atoms ?? 0),
        runCount: Number(totalsRow?.RunCount ?? 0),
        passRate: rate(Number(totalsRow?.Passed ?? 0), Number(totalsRow?.Settled ?? 0)),
        failingScenarios: Number(totalsRow?.FailingScenarios ?? 0),
        cost: toCost({
          totalUsd: Number(totalsRow?.CostTotal ?? 0),
          atoms: Number(totalsRow?.Atoms ?? 0),
          unknown: Number(totalsRow?.CostUnknown ?? 0),
        }),
        series: fillSeries({
          rows: seriesRows,
          startDate: scopedFilter.startDate,
          endDate,
          bucketSeconds,
        }),
      },
      groups: groupBy === "plan" ? withQuietPlans({ groups, plans }) : groups,
    };
  }

  /**
   * Turns a label or test-suite filter into the scenario ids it names — the
   * only place Postgres labels/suite membership meet the run row, which
   * carries neither. INTERSECTS with an explicit scenario filter (two filters both narrow); an empty result stays empty, read as "none of them".
   */
  private async resolveScenarioScope(filter: ResultsFilter): Promise<ResultsFilter> {
    const hasLabels = (filter.labels?.length ?? 0) > 0;
    const hasTestSuites = (filter.testSuiteIds?.length ?? 0) > 0;
    if (!hasLabels && !hasTestSuites) {
      return filter;
    }

    const matched = await this.scenarios.findIdsByLabelsOrTestSuites({
      projectId: filter.projectId,
      labels: filter.labels,
      testSuiteIds: filter.testSuiteIds,
    });

    let ids = matched;
    if (filter.scenarioIds) {
      const asked = new Set(filter.scenarioIds);
      ids = ids.filter((id) => asked.has(id));
    }

    return { ...filter, scenarioIds: ids, labels: undefined, testSuiteIds: undefined };
  }

  /**
   * The project's run plans, keyed both ways. Read whole rather than by the
   * ids the window holds, because the plan grouping must list a plan that
   * didn't run — the worried person checking on a quiet plan is exactly who this is for.
   */
  private async readPlans(projectId: string): Promise<PlanIndex> {
    const plans = await this.scenarios.findPlans({ projectId });
    const bySetId = new Map<string, PlanRecord>();
    const all: { id: string; name: string; slug: string }[] = [];
    for (const plan of plans) {
      bySetId.set(getSuiteSetId(plan.id), { slug: plan.slug, name: plan.name });
      all.push({ id: plan.id, name: plan.name, slug: plan.slug });
    }

    return { bySetId, all };
  }

  /**
   * The name each group row reads under. Only the scenario grouping needs a
   * second read: a plan is already in the plan index, a target is named by
   * the client from its reference id, and a one-execution group takes its title from the run itself.
   */
  private async readGroupTitles({
    projectId,
    groupBy,
    groupRows,
    plans,
  }: {
    projectId: string;
    groupBy: ResultsGroupBy;
    groupRows: RawGroupRow[];
    plans: PlanIndex;
  }): Promise<GroupTitles> {
    if (groupBy === "scenario") {
      const scenarios = await this.scenarios.findTitlesByIds({
        projectId,
        ids: groupRows.map((row) => row.GroupKey),
      });

      return {
        kind: "scenario",
        byId: new Map(
          scenarios.map((scenario) => [
            scenario.id,
            { title: scenario.name, subtitle: scenario.labels.join(", ") },
          ]),
        ),
      };
    }

    return { kind: groupBy, plans };
  }
}

interface PlanRecord {
  slug: string;
  name: string;
}

interface PlanIndex {
  bySetId: Map<string, PlanRecord>;
  all: { id: string; name: string; slug: string }[];
}

/**
 * Where a group row takes its title from. The two arms are told apart by
 * `kind`, so the scenario arm must be excluded from the other: a `kind`
 * holding "scenario" on both arms narrows to neither, and the map is unreachable.
 */
type GroupTitles =
  | { kind: "scenario"; byId: Map<string, { title: string; subtitle: string }> }
  | { kind: Exclude<ResultsGroupBy, "scenario">; plans: PlanIndex };

const runKey = (setId: string, batchRunId: string): string => `${setId}\0${batchRunId}`;

/**
 * The overrides a row carries, or null when it carries none. '' is what a
 * target with no overrides, and every run recorded before targets carried
 * any, reads as.
 */
function targetParametersOf(raw: string): RunParameterValues | null {
  if (raw === "") {
    return null;
  }

  const parsed = parseRunParametersJson(raw);

  return Object.keys(parsed).length > 0 ? parsed : null;
}

/**
 * How a set id reads when no suite owns it: a code-pushed set keeps the
 * SDK-given name (what the pusher recognises), and the on-platform ad-hoc
 * set has its own friendly name, since its raw id is an internal namespace nobody chose.
 */
function planFor(setId: string, plans: Map<string, PlanRecord>): PlanRecord {
  const known = plans.get(setId);
  if (known) {
    return known;
  }

  if (isOnPlatformSet(setId)) {
    return { slug: setId, name: ON_PLATFORM_DISPLAY_NAME };
  }

  const normalised = setId === "" ? DEFAULT_SET_ID : setId;

  return { slug: normalised, name: normalised };
}

function toAtom({
  row,
  ordinalByRun,
  plans,
}: {
  row: RawAtomRow;
  ordinalByRun: Map<string, number>;
  plans: Map<string, PlanRecord>;
}): ResultAtom {
  const costSource = row.CostSource as AtomCostSource;

  return {
    planSlug: planFor(row.SetId, plans).slug,
    runId: row.BatchRunId,
    executionId: row.ScenarioRunId,
    runOrdinal: ordinalByRun.get(runKey(row.SetId, row.BatchRunId)) ?? 0,
    runAt: Number(row.RunAt),
    trigger: row.Trigger === "app" ? "app" : "code",
    note: row.Note === "" ? null : row.Note,
    scenarioId: row.ScenarioId,
    scenarioKey: row.ScenarioKey,
    scenarioName: row.ScenarioName === "" ? null : row.ScenarioName,
    targetKey: row.TargetKey,
    targetParameters: targetParametersOf(row.TargetParameters),
    targetName: row.TargetName === "" ? null : row.TargetName,
    status: row.Status,
    outcome: row.Outcome as AtomOutcome,
    durationMs: row.DurationMs === "" ? null : Number(row.DurationMs),
    // '' is the one value that means "never measured". Zero is a real answer.
    costUsd: row.CostUsd === "" ? null : Number(row.CostUsd),
    costSource,
  };
}

function toGroup({
  row,
  groupBy,
  trend,
  titles,
}: {
  row: RawGroupRow;
  groupBy: ResultsGroupBy;
  trend: TrendPoint[];
  titles: GroupTitles;
}): ResultGroup {
  const atoms = Number(row.Atoms);
  const { key, title, subtitle } = headline({ row, groupBy, titles });

  return {
    key,
    title,
    subtitle,
    passRate: rate(Number(row.Passed), Number(row.Settled)),
    runCount: Number(row.RunCount),
    scenarioCount: Number(row.ScenarioCount),
    lastRunAt: row.LastRunAt === "0" ? null : Number(row.LastRunAt),
    targetKeys: row.TargetKeys,
    // Only a target group names one target. Any other grouping folds runs of
    // several targets, and the overrides of one of them would name the group
    // after a target it does not stand for.
    targetParameters: groupBy === "target" ? targetParametersOf(row.TargetParameters) : null,
    trend,
    cost: toCost({ totalUsd: Number(row.CostTotal), atoms, unknown: Number(row.CostUnknown) }),
  };
}

/**
 * The name a group reads under when the project holds no scenario for it: a
 * scenario that ran from code has no row to read, so it reads under the name
 * its runs carried, and under its key when they carried none.
 */
function carriedName(row: RawGroupRow): string {
  return row.Name !== "" ? row.Name : row.GroupKey;
}

/**
 * The name a target group reads under: the agent name the code that pushed
 * the runs reported, and the key itself when it reported none. A platform
 * target reports none, and the client names it from its own target map.
 */
function carriedTargetName(row: RawGroupRow): string {
  return row.TargetName !== "" ? row.TargetName : row.GroupKey;
}

function headline({
  row,
  groupBy,
  titles,
}: {
  row: RawGroupRow;
  groupBy: ResultsGroupBy;
  titles: GroupTitles;
}): { key: string; title: string; subtitle: string | null } {
  if (groupBy === "scenario" && titles.kind === "scenario") {
    const found = titles.byId.get(row.GroupKey);

    return {
      key: row.GroupKey,
      title: found?.title ?? carriedName(row),
      subtitle: found?.subtitle === "" ? null : (found?.subtitle ?? null),
    };
  }

  if (groupBy === "plan" && "plans" in titles) {
    const plan = planFor(row.GroupKey, titles.plans.bySetId);

    return { key: plan.slug, title: plan.name, subtitle: null };
  }

  if (groupBy === "none" && "plans" in titles) {
    // A group of one execution reads under the plan that ran it.
    return { key: row.GroupKey, title: row.GroupKey, subtitle: null };
  }

  // Target: a run from code reads under the agent name it reported, and the
  // client names a platform reference id through its own target map.
  return { key: row.GroupKey, title: carriedTargetName(row), subtitle: null };
}

/**
 * A pass rate as a percentage, or null when nothing settled. Null and zero
 * are different colours: a run still in flight is not a run that failed,
 * and coercing one to the other paints an unfinished plan red.
 */
function rate(passed: number, settled: number): number | null {
  if (settled <= 0) {
    return null;
  }

  return (passed / settled) * 100;
}

function toCost({
  totalUsd,
  atoms,
  unknown,
}: {
  totalUsd: number;
  atoms: number;
  unknown: number;
}): AtomCost {
  return { totalUsd, knownAtoms: atoms - unknown, unknownAtoms: unknown };
}

/**
 * Sparkline points per group, oldest first, capped. When a group holds
 * more than the cap, the MOST RECENT points are kept: a sparkline is read
 * to see where a plan is heading, so the distant past is what can be dropped.
 */
function foldTrend(rows: RawTrendRow[]): Map<string, TrendPoint[]> {
  const byGroup = new Map<string, RawTrendRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.GroupKey);
    if (list) {
      list.push(row);
    } else {
      byGroup.set(row.GroupKey, [row]);
    }
  }

  const folded = new Map<string, TrendPoint[]>();
  for (const [groupKey, list] of byGroup) {
    const sorted = [...list].sort(
      (a, b) => Number(a.RunAt) - Number(b.RunAt) || a.TrendKey.localeCompare(b.TrendKey),
    );
    const kept = sorted.slice(-MAX_TREND_POINTS);
    folded.set(
      groupKey,
      kept.map((row) => ({
        key: row.TrendKey,
        passRate: rate(Number(row.Passed), Number(row.Settled)),
      })),
    );
  }

  return folded;
}

/**
 * Every bucket in the window, including the ones nothing ran in. A missing
 * bucket is returned as empty rather than dropped, so the chart draws a
 * gap — a zero-height bar would read as total failure, the opposite of what an empty bucket means.
 */
function fillSeries({
  rows,
  startDate,
  endDate,
  bucketSeconds,
}: {
  rows: { Bucket: string; Passed: string; Settled: string }[];
  startDate: number;
  endDate: number;
  bucketSeconds: number;
}): SeriesBucket[] {
  const width = bucketSeconds * 1000;
  const byBucket = new Map(rows.map((row) => [Number(row.Bucket), row]));
  const first = Math.floor(startDate / width) * width;
  const buckets: SeriesBucket[] = [];

  for (let at = first; at <= endDate; at += width) {
    const found = byBucket.get(at);
    const settled = found ? Number(found.Settled) : 0;
    buckets.push({
      label: new Date(at).toISOString(),
      passRate: found ? rate(Number(found.Passed), settled) : null,
      isEmpty: !found,
    });
  }

  return buckets;
}

/**
 * Adds the plans that did not run in the window, so none of them vanishes
 * — they read as nothing in the period (no runs, no scenarios, no pass
 * rate, empty trend). Dropping them would hide exactly the plan a worried person came to check on.
 */
function withQuietPlans({
  groups,
  plans,
}: {
  groups: ResultGroup[];
  plans: PlanIndex;
}): ResultGroup[] {
  const seen = new Set(groups.map((group) => group.key));
  const quiet: ResultGroup[] = [];
  for (const plan of plans.all) {
    if (seen.has(plan.slug)) {
      continue;
    }

    quiet.push({
      key: plan.slug,
      title: plan.name,
      subtitle: null,
      passRate: null,
      runCount: 0,
      scenarioCount: 0,
      lastRunAt: null,
      targetKeys: [],
      targetParameters: null,
      trend: [],
      cost: { totalUsd: 0, knownAtoms: 0, unknownAtoms: 0 },
    });
  }

  return [...groups, ...quiet];
}

/** Exported for the tests that pin the set-id to plan mapping. */
export const __testing = {
  planFor,
  foldTrend,
  fillSeries,
  tryExtractSuiteId,
  rate,
  bucketSecondsFor: ResultAtomsService.bucketSecondsFor,
};
