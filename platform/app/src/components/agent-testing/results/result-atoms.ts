/**
 * The client side of the atom: what the filter row asks for, and how a stored
 * atom becomes a row a person can read.
 *
 * One atom is one scenario, one target, one run. Every view on the Results tab
 * is an aggregation of the same list: the filters cut it, the groupings fold
 * it, the stat strip and the chart derive from it. That is what makes every
 * control move every number on the page.
 *
 * **The fold happens in the database.** The atom count of a project is its
 * scenario-run count, which on a suite-on-merge project reaches tens of
 * thousands over thirty days, so the browser never holds the list the default
 * view aggregates. `scenarios.getResultsOverview` returns the group rows and
 * the totals already folded, and `scenarios.getResultAtoms` returns a bounded
 * page of atoms for a drill-down. The shapes those reads answer with are
 * declared in `server/app-layer/simulations/result-atoms/atom.types.ts` and
 * rendered as they arrive.
 *
 * What is left here is what only the browser knows: the filter state, and the
 * names. A stored atom carries ids, because naming an agent, a prompt, a
 * scenario or a plan belongs in one place on the client, where a rename lands
 * everywhere at once.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/features/agent-testing/results-atoms.feature
 */

import type {
  AtomOutcome,
  ResultAtom,
  ResultsGroupBy,
} from "~/server/app-layer/simulations/result-atoms/atom.types";
import { UNKNOWN_TARGET_KEY } from "~/server/app-layer/simulations/result-atoms/atom.types";
import type { RunPlan } from "./run-plans";

/** What the filter row asks of the list. */
export type ResultFilters = {
  scenarioIds: string[];
  labels: string[];
  targetKeys: string[];
  status: "all" | "passed" | "failed";
};

export const EMPTY_RESULT_FILTERS: ResultFilters = {
  scenarioIds: [],
  labels: [],
  targetKeys: [],
  status: "all",
};

/** True while the filters ask for less than everything. */
export function isNarrowed(filters: ResultFilters): boolean {
  return (
    filters.scenarioIds.length > 0 ||
    filters.labels.length > 0 ||
    filters.targetKeys.length > 0 ||
    filters.status !== "all"
  );
}

/** The status filter as the outcome the read takes, or nothing for all. */
export function filterOutcome(filters: ResultFilters): AtomOutcome | undefined {
  return filters.status === "all" ? undefined : filters.status;
}

/** The four ways the list is read. */
export const RESULT_GROUPINGS = [
  "plan",
  "scenario",
  "target",
  "none",
] as const satisfies readonly ResultsGroupBy[];

export type ResultGrouping = (typeof RESULT_GROUPINGS)[number];

/** What every grouping's tab reads. */
export const RESULT_GROUPING_LABELS: Record<ResultGrouping, string> = {
  plan: "Run plan",
  scenario: "Scenario",
  target: "Target",
  none: "None",
};

/** What a scenario is known to be, beyond what its runs report. */
export type ScenarioFacts = {
  name: string;
  labels: string[];
};

/**
 * One atom, named.
 *
 * The stored atom carries ids; this is what a row of the flat list or of an
 * opened group actually reads. The names are resolved once here rather than in
 * each cell, so the same run reads the same way wherever it is listed.
 */
export type ResultRow = {
  runId: string;
  executionId: string;
  runAt: number;
  planSlug: string;
  planName: string;
  scenarioId: string;
  scenarioName: string;
  labels: string[];
  targetKey: string;
  targetName: string;
  outcome: AtomOutcome;
};

/**
 * A page of stored atoms, named.
 *
 * An atom whose scenario, plan or target is not in the maps keeps its id as
 * its name rather than being dropped: it still happened, and dropping it would
 * make the list disagree with the totals above it, which are counted in the
 * database and know nothing about what the browser could name.
 */
export function toResultRows({
  atoms,
  plans,
  scenarioFacts,
  targetNames,
}: {
  atoms: ResultAtom[];
  /** The project's run plans, keyed by slug. */
  plans: Map<string, RunPlan>;
  /** Names and labels of the project's scenarios, keyed by scenario id. */
  scenarioFacts: Map<string, ScenarioFacts>;
  /** Agent and prompt names, keyed by target reference id. */
  targetNames: Map<string, string>;
}): ResultRow[] {
  return atoms.map((atom) => {
    const facts = scenarioFacts.get(atom.scenarioId);
    return {
      runId: atom.runId,
      executionId: atom.executionId,
      runAt: atom.runAt,
      planSlug: atom.planSlug,
      planName: plans.get(atom.planSlug)?.name ?? atom.planSlug,
      scenarioId: atom.scenarioId,
      scenarioName: facts?.name ?? atom.scenarioId,
      labels: facts?.labels ?? [],
      targetKey: atom.targetKey,
      targetName: targetNameOf({ targetKey: atom.targetKey, targetNames }),
      outcome: atom.outcome,
    };
  });
}

/** How a target reference id reads. */
export function targetNameOf({
  targetKey,
  targetNames,
}: {
  targetKey: string;
  targetNames: Map<string, string>;
}): string {
  if (targetKey === UNKNOWN_TARGET_KEY) return "Unknown target";
  return targetNames.get(targetKey) ?? targetKey;
}

/** How a row names its targets: "dev-agent vs prod-agent". */
export function targetsLabel(names: string[]): string {
  return names.join(" vs ");
}
