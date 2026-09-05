/**
 * Where the rows of the Results tab come from.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useMemo } from "react";
import type { Period, PeriodMode } from "@langwatch/analytics-web/components/PeriodSelector";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { useTargetIdentityMap } from "../../../../behavior/use-target-name-map";
import type {
  CodeScenario,
  ResultAtom,
  ResultGroup,
  ResultTotals,
  RunTarget,
  SeriesBucket,
  RunParameterValues,
} from "@langwatch/scenario-contract";
import { splitTargetKey } from "@langwatch/suite-contract";
import { api } from "../../../../behavior/scenario-api";
import type { TargetKind } from "../../../elements/agent-testing/shared/target-mark";
import type { PlanRowModel } from "./plan-rows-table";
import type { ResultsFilterOption } from "./results-filter-menu";
import {
  codeTargetNames,
  filterOutcome,
  isNarrowed,
  type ResultFilters,
  type ResultGrouping,
  type ResultRow,
  type ScenarioFacts,
  targetNameOf,
  targetParametersOf,
  toResultRows,
} from "./result-atoms";
import type { RunPlan } from "../../../../behavior/agent-testing/results/run-plans";

/**
 * How often the reads refresh while the live stream is down.
 */
const RESULTS_POLL_MS = 10_000;

/** How many atoms one drill-down page holds. The server caps it at 500. */
const ATOM_PAGE = 300;

/** One stable empty list, so a read that answered nothing keeps its identity. */
const EMPTY_GROUPS: ResultGroup[] = [];

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
  /** The kind of agent behind a target key, for the mark that leads its row. */
  resolveTargetKind: (targetKey: string) => TargetKind;
  isLoading: boolean;
  /** True while the source holds atoms it has not handed over. */
  hasMore: boolean;
};

/**
 * The two lists a drill-down narrows on, from the rows that are open.
 */
function narrowTo({ opened, asked }: { opened: string[]; asked: string[] }): string[] {
  if (asked.length === 0) return opened;
  const wanted = new Set(asked);
  return opened.filter((key) => wanted.has(key));
}

/** What the rows and the option lists need from one of the project's scenarios. */
type ScenarioSource = { id: string; name: string; labels: string[] };

/** The filter both reads take, so neither can be in scope of what the other is not. */
type ResultsScope = ReturnType<typeof useResultsScope>;

export type UseResultGroupsArgs = {
  plans: RunPlan[];
  period: Period;
  periodMode: PeriodMode;
  grouping: ResultGrouping;
  filters: ResultFilters;
  /** The keys of the groups a person has opened. */
  openedKeys: string[];
  isSseConnected: boolean;
};

/**
 * The window and the filters, as the shape both reads take.
 */
function useResultsScope({
  projectId,
  period,
  periodMode,
  filters,
}: {
  projectId: string;
  period: Period;
  periodMode: PeriodMode;
  filters: ResultFilters;
}) {
  return useMemo(
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
}

/**
 * The drill-down's own scope: the shared filter, narrowed to the opened rows.
 */
function narrowDrillScope({
  scope,
  grouping,
  openedKeys,
  filters,
}: {
  scope: ResultsScope;
  grouping: ResultGrouping;
  openedKeys: string[];
  filters: ResultFilters;
}): ResultsScope {
  if (grouping === "scenario") {
    return {
      ...scope,
      scenarioIds: narrowTo({ opened: openedKeys, asked: filters.scenarioIds }),
    };
  }
  if (grouping === "target") {
    return {
      ...scope,
      targetKeys: narrowTo({ opened: openedKeys, asked: filters.targetKeys }),
    };
  }
  return scope;
}

/**
 * The two reads, both taking the same filter.
 */
function useResultsReads({
  scope,
  grouping,
  filters,
  openedKeys,
  isEnabled,
  isSseConnected,
}: {
  scope: ResultsScope;
  grouping: ResultGrouping;
  filters: ResultFilters;
  openedKeys: string[];
  isEnabled: boolean;
  isSseConnected: boolean;
}) {
  const refetchInterval = isSseConnected ? false : RESULTS_POLL_MS;

  const overview = api.scenarios.getResultsOverview.useQuery(
    { ...scope, groupBy: grouping },
    { enabled: isEnabled, refetchInterval },
  );

  const isDrilling =
    grouping === "scenario" || grouping === "target" ? openedKeys.length > 0 : grouping === "none";

  const drillScope = useMemo(
    () => narrowDrillScope({ scope, grouping, openedKeys, filters }),
    [scope, grouping, openedKeys, filters],
  );

  const atomPage = api.scenarios.getResultAtoms.useQuery(
    { ...drillScope, limit: ATOM_PAGE },
    { enabled: isEnabled && isDrilling, refetchInterval },
  );

  return { overview, atomPage };
}

/** The names and labels the rows read, keyed by scenario id. */
function toScenarioFacts(scenarios: ScenarioSource[]): Map<string, ScenarioFacts> {
  const facts = new Map<string, ScenarioFacts>();
  for (const scenario of scenarios) {
    facts.set(scenario.id, { name: scenario.name, labels: scenario.labels });
  }
  return facts;
}

/** The atoms of the drill-down page, named with what the project knows. */
function useNamedRows({
  atoms,
  plans,
  scenarios,
  targetNames,
  targetParameters,
}: {
  atoms: ResultAtom[] | undefined;
  plans: RunPlan[];
  scenarios: ScenarioSource[] | undefined;
  targetNames: Map<string, string>;
  targetParameters: Map<string, RunParameterValues>;
}): ResultRow[] {
  const scenarioFacts = useMemo(() => toScenarioFacts(scenarios ?? []), [scenarios]);

  const planBySlug = useMemo(() => new Map(plans.map((plan) => [plan.slug, plan])), [plans]);

  return useMemo(
    () =>
      toResultRows({
        atoms: atoms ?? [],
        plans: planBySlug,
        scenarioFacts,
        targetNames,
        targetParameters,
      }),
    [atoms, planBySlug, scenarioFacts, targetNames, targetParameters],
  );
}

/**
 * The runs behind each opened group, keyed by that group's key.
 */
function groupRowsByKey({
  rows,
  grouping,
}: {
  rows: ResultRow[];
  grouping: ResultGrouping;
}): Map<string, ResultRow[]> {
  const byKey = new Map<string, ResultRow[]>();
  if (grouping !== "scenario" && grouping !== "target") return byKey;

  for (const row of rows) {
    const key = grouping === "scenario" ? row.scenarioKey : row.targetKey;
    const held = byKey.get(key);
    if (held) held.push(row);
    else byKey.set(key, [row]);
  }
  return byKey;
}

/**
 * The rows of the Run plan grouping, quiet plans included.
 */
function buildPlanRows({
  plans,
  groups,
  grouping,
  filters,
}: {
  plans: RunPlan[];
  groups: ResultGroup[];
  grouping: ResultGrouping;
  filters: ResultFilters;
}): PlanRowModel[] {
  if (grouping !== "plan") return [];

  const byKey = new Map(groups.map((group) => [group.key, group]));
  const narrowed = isNarrowed(filters);

  // The read keys a set that runs from code by its bare set id, while the
  // list names it under the external plan slug, so such a plan is looked up
  // by its set id when its slug finds nothing.
  const groupOf = (plan: RunPlan): ResultGroup | null =>
    byKey.get(plan.slug) ??
    (plan.kind === "external" ? byKey.get(plan.scenarioSetId) : undefined) ??
    null;

  return plans
    .map((plan) => ({ plan, group: groupOf(plan) }))
    .filter(({ group }) => !narrowed || group !== null);
}

/**
 * The option lists of the filter row.
 */
function useResultFilterOptions({
  scenarios,
  codeScenarios,
  codeTargets,
  targetNames,
  targetParameters,
}: {
  scenarios: ScenarioSource[] | undefined;
  /** The scenarios that ran from code inside the window, which the project holds no row for. */
  codeScenarios: CodeScenario[] | undefined;
  /**
   * The targets the window's runs name that the stored lists cannot: the
   * targets a run from code named, and the parameter variants of stored ones.
   */
  codeTargets: RunTarget[] | undefined;
  targetNames: Map<string, string>;
  targetParameters: Map<string, RunParameterValues>;
}) {
  const scenarioOptions = useMemo(
    () =>
      [
        ...(scenarios ?? []).map((scenario) => ({
          value: scenario.id,
          label: scenario.name,
        })),
        ...(codeScenarios ?? []).map((scenario) => ({
          value: scenario.key,
          label: scenario.name,
        })),
      ].sort((a, b) => a.label.localeCompare(b.label)),
    [scenarios, codeScenarios],
  );

  const labelOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const scenario of scenarios ?? []) {
      for (const label of scenario.labels) seen.add(label);
    }
    return [...seen].sort().map((label) => ({ value: label, label }) satisfies ResultsFilterOption);
  }, [scenarios]);

  // The project's agents and prompts, and beside them the targets the window
  // names that the project holds no row for: the agents a run from code
  // named, and the stored agents run with parameter overrides, which read
  // under the agent's name and their parameters.
  const targetOptions = useMemo(
    () =>
      [
        ...[...targetNames.entries()].map(([value, label]) => ({
          value,
          label,
        })),
        ...(codeTargets ?? []).map((target) => ({
          value: target.key,
          label: target.referenceId
            ? targetNameOf({
                targetKey: target.key,
                targetNames,
                targetParameters,
              })
            : target.name,
        })),
      ].sort((a, b) => a.label.localeCompare(b.label)),
    [targetNames, codeTargets, targetParameters],
  );

  return { scenarioOptions, labelOptions, targetOptions };
}

/**
 * The parameter overrides of every target the page knows, keyed by target
 * key, so a target with overrides reads them after its name.
 */
function useTargetParameters({
  codeTargets,
  groups,
  atoms,
}: {
  codeTargets: RunTarget[] | undefined;
  groups: ResultGroup[];
  atoms: ResultAtom[] | undefined;
}): Map<string, RunParameterValues> {
  return useMemo(
    () =>
      targetParametersOf([
        ...(codeTargets ?? []).map((target) => ({
          targetKey: target.key,
          targetParameters: target.parameters,
        })),
        ...groups.map((group) => ({
          targetKey: group.key,
          targetParameters: group.targetParameters,
        })),
        ...(atoms ?? []),
      ]),
    [codeTargets, groups, atoms],
  );
}

/**
 * Every name a target key can read under: the project's agents and prompts, and the
 * agent names the runs from code reported.
 */
function useTargetNames({
  targetNames,
  codeTargets,
  groups,
  atoms,
}: {
  targetNames: Map<string, string>;
  codeTargets: RunTarget[] | undefined;
  groups: ResultGroup[];
  atoms: ResultAtom[] | undefined;
}): Map<string, string> {
  return useMemo(() => {
    const carried = codeTargetNames([
      ...(codeTargets ?? []).map((target) => ({
        targetKey: target.key,
        targetName: target.name,
      })),
      // A target grouping row reads under the name its newest run reported.
      ...groups.map((group) => ({
        targetKey: group.key,
        targetName: group.title,
      })),
      ...(atoms ?? []),
    ]);
    for (const [key, name] of targetNames) carried.set(key, name);
    return carried;
  }, [targetNames, codeTargets, groups, atoms]);
}

/**
 * Everything the page needs to name a target key: the names, the parameter
 * overrides, and the one function every row and cell names a key through.
 */
function useTargetNaming({
  platformTargetNames,
  codeTargets,
  groups,
  atoms,
}: {
  platformTargetNames: Map<string, string>;
  codeTargets: RunTarget[] | undefined;
  groups: ResultGroup[];
  atoms: ResultAtom[] | undefined;
}) {
  const targetParameters = useTargetParameters({ codeTargets, groups, atoms });
  const targetNames = useTargetNames({
    targetNames: platformTargetNames,
    codeTargets,
    groups,
    atoms,
  });
  const resolveTargetName = useMemo(
    () => (targetKey: string) => targetNameOf({ targetKey, targetNames, targetParameters }),
    [targetNames, targetParameters],
  );
  return { targetNames, targetParameters, resolveTargetName };
}

/**
 * What the page reads off the agents and the prompts of the project: the name a target
 * key stands for, and the kind of agent behind it.
 */
function useTargetReads() {
  const targetIdentities = useTargetIdentityMap();
  const platformTargetNames = useMemo(
    () => new Map([...targetIdentities].map(([id, identity]) => [id, identity.name] as const)),
    [targetIdentities],
  );
  const resolveTargetKind = useMemo(
    () => (targetKey: string) =>
      targetIdentities.get(splitTargetKey(targetKey).referenceId)?.kind ?? "unknown",
    [targetIdentities],
  );
  return { platformTargetNames, resolveTargetKind };
}

export function useResultGroups({
  plans,
  period,
  periodMode,
  grouping,
  filters,
  openedKeys,
  isSseConnected,
}: UseResultGroupsArgs): UseResultGroupsResult {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const scope = useResultsScope({ projectId, period, periodMode, filters });

  const { overview, atomPage } = useResultsReads({
    scope,
    grouping,
    filters,
    openedKeys,
    isEnabled: !!project,
    isSseConnected,
  });

  const { data: scenarios } = api.scenarios.getAll.useQuery({ projectId }, { enabled: !!project });

  // Read over the window alone, never through the filters: a scenario filter
  // already in force must not hide the options that undo it.
  const { data: codeScenarios } = api.scenarios.getCodeScenarios.useQuery(
    { projectId, startDate: scope.startDate, endDate: scope.endDate },
    { enabled: !!project },
  );

  // Read over the window alone, for the same reason.
  const { data: codeTargets } = api.scenarios.getRunTargets.useQuery(
    { projectId, startDate: scope.startDate, endDate: scope.endDate },
    { enabled: !!project },
  );

  const { platformTargetNames, resolveTargetKind } = useTargetReads();
  const groups = overview.data?.groups ?? EMPTY_GROUPS;

  const { targetNames, targetParameters, resolveTargetName } = useTargetNaming({
    platformTargetNames,
    codeTargets,
    // Only a target grouping row names a target. Any other grouping keys
    // its rows by something else, so its titles are not target names.
    groups: grouping === "target" ? groups : EMPTY_GROUPS,
    atoms: atomPage.data?.atoms,
  });

  const options = useResultFilterOptions({
    scenarios,
    codeScenarios,
    codeTargets,
    targetNames: platformTargetNames,
    targetParameters,
  });

  const rows = useNamedRows({
    atoms: atomPage.data?.atoms,
    plans,
    scenarios,
    targetNames,
    targetParameters,
  });

  const rowsByGroupKey = useMemo(() => groupRowsByKey({ rows, grouping }), [rows, grouping]);

  const planRows = useMemo(
    () => buildPlanRows({ plans, groups, grouping, filters }),
    [plans, groups, grouping, filters],
  );

  return {
    planRows,
    groups,
    rowsByGroupKey,
    rows,
    totals: overview.data?.totals ?? EMPTY_TOTALS,
    buckets: overview.data?.totals.series ?? [],
    ...options,
    resolveTargetName,
    resolveTargetKind,
    isLoading: overview.isLoading,
    hasMore: atomPage.data?.hasMore ?? false,
  };
}
