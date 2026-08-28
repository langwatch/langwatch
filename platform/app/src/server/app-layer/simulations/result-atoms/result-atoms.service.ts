import type { PrismaClient } from "~/generated/prisma/client";
import {
  DEFAULT_SET_ID,
  isOnPlatformSet,
  ON_PLATFORM_DISPLAY_NAME,
} from "~/server/scenarios/internal-set-id";
import { mapStatus } from "~/server/simulations/simulation-run.mappers";
import { extractSuiteId, getSuiteSetId } from "~/server/suites/suite-set-id";
import type {
  AtomCost,
  AtomCostSource,
  AtomOutcome,
  CodeScenario,
  CodeTarget,
  ResultAtom,
  ResultGroup,
  ResultsFilter,
  ResultsGroupBy,
  ResultsOverview,
  SeriesBucket,
  TrendPoint,
} from "./atom.types";
import {
  MAX_TREND_POINTS,
  type RawAtomRow,
  type RawGroupRow,
  type RawTrendRow,
  type ResultAtomsClickHouseRepository,
} from "./result-atoms.clickhouse.repository";

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

/**
 * How wide one bucket of the pass-rate chart is, from the width of the window.
 *
 * A fixed bucket count would make a one-day window draw 30 buckets of 48
 * minutes, which reads as precision the data does not have. Anchoring on time
 * instead keeps a bucket a unit a person recognises.
 */
export function bucketSecondsFor({
  startDate,
  endDate,
}: {
  startDate: number;
  endDate: number;
}): number {
  const days = (endDate - startDate) / (DAY_SECONDS * 1000);
  if (days <= 2) return HOUR_SECONDS;
  if (days <= 60) return DAY_SECONDS;
  return 7 * DAY_SECONDS;
}

/**
 * Reads results as atoms, and folds them the four ways the Results tab groups.
 *
 * The database does the folding. Returning atoms and grouping them in the
 * browser works for a small project and does not survive a real one: an atom
 * is one scenario run, so a suite of 50 scenarios against 2 targets running on
 * every merge produces around 60,000 atoms in 30 days, roughly 27 MB of JSON.
 * The overview therefore aggregates server-side and the atom list is a bounded
 * drill-down, not the source the page adds up.
 */
export class ResultAtomsService {
  constructor(
    private readonly repository: ResultAtomsClickHouseRepository,
    private readonly prisma: PrismaClient,
  ) {}

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
    filter = await this.resolveScenarioScope(filter);
    const [page, ordinals, plans] = await Promise.all([
      this.repository.findAtoms({ filter, limit, cursor }),
      this.repository.findRunOrdinals(filter),
      this.readPlans(filter.projectId),
    ]);

    const ordinalByRun = new Map(
      ordinals.map((row) => [
        runKey(row.SetId, row.BatchRunId),
        Number(row.Ordinal),
      ]),
    );

    return {
      atoms: page.atoms.map((row) =>
        toAtom({ row, ordinalByRun, plans: plans.bySetId }),
      ),
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
    const rows = await this.repository.findCodeScenarios({
      projectId,
      startDate,
      endDate,
    });
    return rows.map((row) => ({
      key: row.ScenarioKey,
      name: row.Name !== "" ? row.Name : row.ScenarioKey,
    }));
  }

  /**
   * The targets a run from code named inside the window, for the target
   * filter. Read over the window alone, for the same reason the scenarios
   * that ran from code are.
   */
  async getCodeTargets({
    projectId,
    startDate,
    endDate,
  }: {
    projectId: string;
    startDate: number;
    endDate?: number;
  }): Promise<CodeTarget[]> {
    const rows = await this.repository.findCodeTargets({
      projectId,
      startDate,
      endDate,
    });
    return rows.map((row) => ({
      key: row.TargetKey,
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
    filter = await this.resolveScenarioScope(filter);
    const endDate = filter.endDate ?? Date.now();
    const bucketSeconds = bucketSecondsFor({
      startDate: filter.startDate,
      endDate,
    });

    const [totalsRow, groupRows, trendRows, seriesRows, plans] =
      await Promise.all([
        this.repository.aggregateTotals(filter),
        this.repository.aggregateGroups({ filter, groupBy }),
        this.repository.aggregateTrend({ filter, groupBy }),
        this.repository.aggregateSeries({ filter, bucketSeconds }),
        this.readPlans(filter.projectId),
      ]);

    const trendByGroup = foldTrend(trendRows);
    const titles = await this.readGroupTitles({
      projectId: filter.projectId,
      groupBy,
      groupRows,
      plans,
    });

    const groups = groupRows.map((row) =>
      toGroup({
        row,
        groupBy,
        trend: trendByGroup.get(row.GroupKey) ?? [],
        titles,
      }),
    );

    return {
      totals: {
        executions: Number(totalsRow?.Atoms ?? 0),
        runCount: Number(totalsRow?.RunCount ?? 0),
        passRate: rate(
          Number(totalsRow?.Passed ?? 0),
          Number(totalsRow?.Settled ?? 0),
        ),
        failingScenarios: Number(totalsRow?.FailingScenarios ?? 0),
        cost: toCost({
          totalUsd: Number(totalsRow?.CostTotal ?? 0),
          atoms: Number(totalsRow?.Atoms ?? 0),
          unknown: Number(totalsRow?.CostUnknown ?? 0),
        }),
        series: fillSeries({
          rows: seriesRows,
          startDate: filter.startDate,
          endDate,
          bucketSeconds,
        }),
      },
      groups: groupBy === "plan" ? withQuietPlans({ groups, plans }) : groups,
    };
  }

  /**
   * Turns a label or a folder filter into the scenario ids it names.
   *
   * Labels and folder membership live in Postgres and the run row carries
   * neither, so this is the only place the two stores meet. The result
   * INTERSECTS with an explicit scenario filter rather than replacing it: two
   * filters both narrow, and a union would widen the page when a person added
   * a second condition.
   *
   * An intersection that comes out empty stays empty. The repository reads an
   * empty list as "none of them" and sends no query, which is what a filter
   * matching nothing should do.
   */
  private async resolveScenarioScope(
    filter: ResultsFilter,
  ): Promise<ResultsFilter> {
    const hasLabels = (filter.labels?.length ?? 0) > 0;
    const hasFolders = (filter.folderIds?.length ?? 0) > 0;
    if (!hasLabels && !hasFolders) return filter;

    const matched = await this.prisma.scenario.findMany({
      where: {
        projectId: filter.projectId,
        archivedAt: null,
        ...(hasLabels ? { labels: { hasSome: filter.labels } } : {}),
        ...(hasFolders ? { folderId: { in: filter.folderIds } } : {}),
      },
      select: { id: true },
    });

    let ids = matched.map((scenario) => scenario.id);
    if (filter.scenarioIds) {
      const asked = new Set(filter.scenarioIds);
      ids = ids.filter((id) => asked.has(id));
    }
    return {
      ...filter,
      scenarioIds: ids,
      labels: undefined,
      folderIds: undefined,
    };
  }

  /**
   * The project's run plans, keyed both ways.
   *
   * Read whole rather than by the ids the window happens to hold, because the
   * plan grouping must list a plan that did not run: the person who opens this
   * page to check on a plan they are worried about is exactly the person whose
   * plan has been quiet.
   */
  private async readPlans(projectId: string): Promise<PlanIndex> {
    const suites = await this.prisma.simulationSuite.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, name: true, slug: true },
    });
    const bySetId = new Map<string, PlanRecord>();
    for (const suite of suites) {
      bySetId.set(getSuiteSetId(suite.id), {
        slug: suite.slug,
        name: suite.name,
      });
    }
    return { bySetId, all: suites };
  }

  /**
   * The name each group row reads under.
   *
   * Only the scenario grouping needs a second read: a plan is already in the
   * plan index, a target is named by the client from its reference id, and a
   * group of one execution takes its title from the run itself.
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
      const scenarios = await this.prisma.scenario.findMany({
        where: { projectId, id: { in: groupRows.map((row) => row.GroupKey) } },
        select: { id: true, name: true, labels: true },
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
 * Where a group row takes its title from.
 *
 * The two arms are told apart by `kind`, so the scenario arm must be excluded
 * from the other one: a `kind` that still holds "scenario" on both arms
 * narrows to neither and the map is then unreachable.
 */
type GroupTitles =
  | { kind: "scenario"; byId: Map<string, { title: string; subtitle: string }> }
  | { kind: Exclude<ResultsGroupBy, "scenario">; plans: PlanIndex };

const runKey = (setId: string, batchRunId: string): string =>
  `${setId}\0${batchRunId}`;

/**
 * How a set id reads when no suite owns it.
 *
 * A code-pushed set keeps the name the SDK gave it, which is what the person
 * who pushed it will recognise. The on-platform ad-hoc set has a friendly name
 * of its own, because its raw id is an internal namespace nobody chose.
 */
function planFor(setId: string, plans: Map<string, PlanRecord>): PlanRecord {
  const known = plans.get(setId);
  if (known) return known;
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
    targetName: row.TargetName === "" ? null : row.TargetName,
    status: mapStatus(row.Status),
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
    trend,
    cost: toCost({
      totalUsd: Number(row.CostTotal),
      atoms,
      unknown: Number(row.CostUnknown),
    }),
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
    return {
      key: row.GroupKey,
      title: row.GroupKey,
      subtitle: null,
    };
  }
  // Target: a run from code reads under the agent name it reported, and the
  // client names a platform reference id through its own target map.
  return { key: row.GroupKey, title: carriedTargetName(row), subtitle: null };
}

/**
 * A pass rate as a percentage, or null when nothing settled.
 *
 * Null and zero are different colours: a run still in flight is not a run that
 * failed, and coercing one to the other paints an unfinished plan red.
 */
export function rate(passed: number, settled: number): number | null {
  if (settled <= 0) return null;
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
 * Sparkline points per group, oldest first, capped.
 *
 * When a group holds more than the cap, the MOST RECENT points are kept: a
 * sparkline is read to see where a plan is heading, so the distant past is what
 * can be dropped.
 */
function foldTrend(rows: RawTrendRow[]): Map<string, TrendPoint[]> {
  const byGroup = new Map<string, RawTrendRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.GroupKey);
    if (list) list.push(row);
    else byGroup.set(row.GroupKey, [row]);
  }

  const folded = new Map<string, TrendPoint[]>();
  for (const [groupKey, list] of byGroup) {
    const sorted = [...list].sort(
      (a, b) =>
        Number(a.RunAt) - Number(b.RunAt) ||
        a.TrendKey.localeCompare(b.TrendKey),
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
 * Every bucket in the window, including the ones nothing ran in.
 *
 * A missing bucket is returned as empty rather than dropped, so the chart draws
 * a gap. A zero-height bar there would read as a run in which everything
 * failed, which is the opposite of what an empty bucket means.
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
 * Adds the plans that did not run in the window, so none of them vanishes.
 *
 * They read as nothing in the period: no runs, no scenarios, no pass rate and
 * an empty trend. Dropping them would hide exactly the plan a worried person
 * came to check on.
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
  for (const suite of plans.all) {
    if (seen.has(suite.slug)) continue;
    quiet.push({
      key: suite.slug,
      title: suite.name,
      subtitle: null,
      passRate: null,
      runCount: 0,
      scenarioCount: 0,
      lastRunAt: null,
      targetKeys: [],
      trend: [],
      cost: { totalUsd: 0, knownAtoms: 0, unknownAtoms: 0 },
    });
  }
  return [...groups, ...quiet];
}

/** Exported for the tests that pin the set-id to plan mapping. */
export const __testing = { planFor, foldTrend, fillSeries, extractSuiteId };
