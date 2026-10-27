import {
  type CodeScenario,
  type ResultAtom,
  type ResultsFilter,
  type ResultsGroupBy,
  type ResultsOverview,
  type RunTarget,
} from "@langwatch/scenario-contract";
import { MAX_TREND_POINTS } from "@langwatch/scenario-contract";
import { extractSuiteId, getSuiteSetId } from "@langwatch/suite-contract";
import { Temporal, nowInstant } from "@langwatch/time";

import {
  type RawGroupRow,
  type ResultAtomsRepository,
} from "../repositories/result-atoms.repository.ts";
import type { ScenarioRepository } from "../repositories/scenario.repository.ts";
import {
  fillSeries,
  foldTrend,
  type GroupTitles,
  planFor,
  type PlanIndex,
  type PlanRecord,
  computePassRate,
  runKey,
  parseTargetParameters,
  toAtom,
  toCost,
  toGroup,
  withQuietPlans,
} from "../rules/result-atoms-fold.rules.ts";

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

/**
 * Reads results as atoms and folds them the four ways Results groups. Server-side:
 * 50 scenarios x 2 targets per merge produces ~60k atoms (~27 MB) in 30 days;
 * list is bounded drill-down, not what page adds up.
 */
export class ResultAtomsService {
  static create(
    repository: ResultAtomsRepository,
    scenarios: ScenarioRepository,
  ): ResultAtomsService {
    return new ResultAtomsService(repository, scenarios);
  }

  private constructor(
    private readonly repository: ResultAtomsRepository,
    private readonly scenarios: ScenarioRepository,
  ) {}

  /**
   * Bucket width for pass-rate chart from window width. Anchoring on time keeps
   * a bucket a recognizable unit rather than false precision.
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
      this.repository.listAtoms({ filter: scopedFilter, limit, cursor }),
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
      parameters: parseTargetParameters(row.TargetParameters),
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
    const endDate = scopedFilter.endDate ?? nowInstant().epochMilliseconds;
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

    const trendByGroup = foldTrend({ rows: trendRows, maxPoints: MAX_TREND_POINTS });
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
        executions: Number(totalsRow.Atoms),
        runCount: Number(totalsRow.RunCount),
        passRate: computePassRate(Number(totalsRow.Passed), Number(totalsRow.Settled)),
        failingScenarios: Number(totalsRow.FailingScenarios),
        cost: toCost({
          totalUsd: Number(totalsRow.CostTotal),
          atoms: Number(totalsRow.Atoms),
          unknown: Number(totalsRow.CostUnknown),
        }),
        series: fillSeries({
          labelFor: (at) =>
            Temporal.Instant.fromEpochMilliseconds(at).toString({ fractionalSecondDigits: 3 }),
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
   * Resolve label or test-suite filter to scenario ids (INTERSECTS with explicit
   * scenario filter; empty result stays empty).
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
   * The name each group row reads under. Only scenario grouping needs a second read;
   * plan is in index, target is named by client, one-execution group from run itself.
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

/** Exported for the tests that pin the set-id to plan mapping. */
export const __testing = {
  planFor,
  foldTrend,
  fillSeries,
  extractSuiteId,
  computePassRate,
  bucketSecondsFor: (
    ...args: Parameters<typeof ResultAtomsService.bucketSecondsFor>
  ): ReturnType<typeof ResultAtomsService.bucketSecondsFor> =>
    ResultAtomsService.bucketSecondsFor(...args),
};
