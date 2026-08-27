/**
 * Where the rows of the Results tab come from.
 *
 * This is the only place that knows the source. Everything above it reads the
 * group rows, the totals and the named rows, so a change to the read is a
 * change to this file and to nothing that renders.
 *
 * Two reads, one filter. `getResultsOverview` folds in the database and
 * answers the group rows and every number of the stat strip; `getResultAtoms`
 * answers a bounded page of atoms for the drill-down, which is the flat list
 * and the runs behind an opened row. Both take the same filter, so no control
 * on the page can move one number without moving the rest.
 *
 * The overview is not derived from the atom page. A page holds whatever fitted
 * inside its cap, and a total added up from it would read as the total of
 * everything while being the total of a part.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useMemo } from "react";
import type { Period, PeriodMode } from "~/components/PeriodSelector";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import type {
  ResultGroup,
  ResultTotals,
  SeriesBucket,
} from "~/server/app-layer/simulations/result-atoms/atom.types";
import { api } from "~/utils/api";
import type { PlanRowModel } from "./PlanRowsTable";
import type { ResultsFilterOption } from "./ResultsFilterMenu";
import {
  filterOutcome,
  isNarrowed,
  type ResultFilters,
  type ResultGrouping,
  type ResultRow,
  type ScenarioFacts,
  targetNameOf,
  toResultRows,
} from "./result-atoms";
import type { RunPlan } from "./run-plans";

/**
 * How often the reads refresh while the live stream is down.
 *
 * The stream is what normally moves a running run on this page. This is the
 * fallback, so it is slow enough to cost little and quick enough that a person
 * watching a run does not think the page has stopped.
 */
const RESULTS_POLL_MS = 10_000;

/** How many atoms one drill-down page holds. The server caps it at 500. */
const ATOM_PAGE = 300;

/** The totals of a window that holds nothing, so the strip still reads. */
const EMPTY_TOTALS: ResultTotals = {
  executions: 0,
  runCount: 0,
  passRate: null,
  failingScenarios: 0,
  cost: { totalUsd: 0, knownAtoms: 0, unknownAtoms: 0 },
  series: [],
};

export type UseResultGroupsResult = {
  /** The rows of the Run plan grouping, quiet plans included. */
  planRows: PlanRowModel[];
  /** The rows of the Scenario and Target groupings. */
  groups: ResultGroup[];
  /** The runs behind each opened group, keyed by that group's key. */
  rowsByGroupKey: Map<string, ResultRow[]>;
  /** The named atoms of the flat list. */
  rows: ResultRow[];
  totals: ResultTotals;
  buckets: SeriesBucket[];
  scenarioOptions: ResultsFilterOption[];
  labelOptions: ResultsFilterOption[];
  targetOptions: ResultsFilterOption[];
  resolveTargetName: (targetKey: string) => string;
  isLoading: boolean;
  /** True while the source holds atoms it has not handed over. */
  hasMore: boolean;
};

/**
 * The two lists a drill-down narrows on, from the rows that are open.
 *
 * Both narrow rather than widen: an open row asks for its own runs, and a
 * filter already cutting those ids must keep cutting them. An intersection
 * that comes out empty is asked for as empty, which reads as nothing rather
 * than as everything.
 */
function narrowTo({
  opened,
  asked,
}: {
  opened: string[];
  asked: string[];
}): string[] {
  if (asked.length === 0) return opened;
  const wanted = new Set(asked);
  return opened.filter((key) => wanted.has(key));
}

export function useResultGroups({
  plans,
  period,
  periodMode,
  grouping,
  filters,
  openedKeys,
  isSseConnected,
}: {
  plans: RunPlan[];
  period: Period;
  periodMode: PeriodMode;
  grouping: ResultGrouping;
  filters: ResultFilters;
  /** The keys of the groups a person has opened. */
  openedKeys: string[];
  isSseConnected: boolean;
}): UseResultGroupsResult {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  // A relative window sends no end. Its end is pinned at mount, so sending it
  // would filter on "started before the page loaded" and a run beginning while
  // someone watches would never appear, on the page whose job is watching runs
  // happen. A window a person picked by hand does send one: they asked for
  // that window, and it must not drift.
  const scope = useMemo(
    () => ({
      projectId,
      startDate: period.startDate.getTime(),
      endDate: periodMode === "absolute" ? period.endDate.getTime() : undefined,
      scenarioIds: filters.scenarioIds.length ? filters.scenarioIds : undefined,
      labels: filters.labels.length ? filters.labels : undefined,
      targetKeys: filters.targetKeys.length ? filters.targetKeys : undefined,
      outcome: filterOutcome(filters),
    }),
    [projectId, period, periodMode, filters],
  );

  const refetchInterval = isSseConnected ? false : RESULTS_POLL_MS;

  const overview = api.scenarios.getResultsOverview.useQuery(
    { ...scope, groupBy: grouping },
    { enabled: !!project, refetchInterval },
  );

  // The drill-down. It is asked for only when something is drilling into:
  // the flat list, or the runs behind an opened row. The plan grouping never
  // opens a row in place, so it asks for no atoms at all.
  const isFlat = grouping === "none";
  const isDrilling =
    grouping === "scenario" || grouping === "target"
      ? openedKeys.length > 0
      : isFlat;

  const drillScope = useMemo(() => {
    if (grouping === "scenario") {
      return {
        ...scope,
        scenarioIds: narrowTo({
          opened: openedKeys,
          asked: filters.scenarioIds,
        }),
      };
    }
    if (grouping === "target") {
      return {
        ...scope,
        targetKeys: narrowTo({ opened: openedKeys, asked: filters.targetKeys }),
      };
    }
    return scope;
  }, [scope, grouping, openedKeys, filters]);

  const atomPage = api.scenarios.getResultAtoms.useQuery(
    { ...drillScope, limit: ATOM_PAGE },
    { enabled: !!project && isDrilling, refetchInterval },
  );

  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId },
    { enabled: !!project },
  );

  const targetNames = useTargetNameMap();

  const scenarioFacts = useMemo(() => {
    const facts = new Map<string, ScenarioFacts>();
    for (const scenario of scenarios ?? []) {
      facts.set(scenario.id, { name: scenario.name, labels: scenario.labels });
    }
    return facts;
  }, [scenarios]);

  const planBySlug = useMemo(() => {
    const bySlug = new Map<string, RunPlan>();
    for (const plan of plans) bySlug.set(plan.slug, plan);
    return bySlug;
  }, [plans]);

  const rows = useMemo(
    () =>
      toResultRows({
        atoms: atomPage.data?.atoms ?? [],
        plans: planBySlug,
        scenarioFacts,
        targetNames,
      }),
    [atomPage.data, planBySlug, scenarioFacts, targetNames],
  );

  const rowsByGroupKey = useMemo(() => {
    const byKey = new Map<string, ResultRow[]>();
    if (grouping !== "scenario" && grouping !== "target") return byKey;
    for (const row of rows) {
      const key = grouping === "scenario" ? row.scenarioId : row.targetKey;
      const held = byKey.get(key);
      if (held) held.push(row);
      else byKey.set(key, [row]);
    }
    return byKey;
  }, [rows, grouping]);

  const groups = overview.data?.groups ?? [];

  const planRows = useMemo<PlanRowModel[]>(() => {
    if (grouping !== "plan") return [];

    const byPlanSlug = new Map(groups.map((group) => [group.key, group]));
    const narrowed = isNarrowed(filters);

    return (
      plans
        .map((plan) => ({ plan, group: byPlanSlug.get(plan.slug) ?? null }))
        // A quiet plan still has a row, so a plan someone is worried about does
        // not vanish the moment it stops running. It stands down only while a
        // filter is narrowing the question, where a row matching nothing is
        // noise rather than reassurance.
        .filter(({ group }) => !narrowed || group !== null)
    );
  }, [plans, groups, grouping, filters]);

  // Every option list is built from the project rather than from the window,
  // so a filter never hides its own way back: an option built from what the
  // page already cut away cannot be chosen to undo the cut.
  const scenarioOptions = useMemo(
    () =>
      (scenarios ?? [])
        .map((scenario) => ({ value: scenario.id, label: scenario.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [scenarios],
  );

  const labelOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const scenario of scenarios ?? []) {
      for (const label of scenario.labels) seen.add(label);
    }
    return [...seen]
      .sort()
      .map((label) => ({ value: label, label }) satisfies ResultsFilterOption);
  }, [scenarios]);

  const targetOptions = useMemo(
    () =>
      [...targetNames.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [targetNames],
  );

  const resolveTargetName = useMemo(
    () => (targetKey: string) => targetNameOf({ targetKey, targetNames }),
    [targetNames],
  );

  return {
    planRows,
    groups,
    rowsByGroupKey,
    rows,
    totals: overview.data?.totals ?? EMPTY_TOTALS,
    buckets: overview.data?.totals.series ?? [],
    scenarioOptions,
    labelOptions,
    targetOptions,
    resolveTargetName,
    isLoading: overview.isLoading,
    hasMore: atomPage.data?.hasMore ?? false,
  };
}
