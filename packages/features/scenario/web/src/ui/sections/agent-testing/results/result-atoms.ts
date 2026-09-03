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
  RunParameterValues,
} from "@langwatch/scenario-contract";
import { UNKNOWN_TARGET_KEY } from "@langwatch/scenario-contract";
import {
  splitTargetKey,
  TARGET_LABEL_SEPARATOR,
  targetParametersLabel,
} from "@langwatch/suite-contract";
import {
  CODE_TARGET_NAME,
  type RunPlan,
  toExternalPlanSlug,
} from "../../../../behavior/agent-testing/results/run-plans";

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
  /** What the scenario folds under, and what an opened scenario row is keyed by. */
  scenarioKey: string;
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
  targetParameters,
}: {
  atoms: ResultAtom[];
  /** The project's run plans, keyed by slug. */
  plans: Map<string, RunPlan>;
  /** Names and labels of the project's scenarios, keyed by scenario id. */
  scenarioFacts: Map<string, ScenarioFacts>;
  /** Agent and prompt names, keyed by target reference id. */
  targetNames: Map<string, string>;
  /** The parameter overrides the page knows, keyed by target key. */
  targetParameters?: Map<string, RunParameterValues>;
}): ResultRow[] {
  return atoms.map((atom) => {
    const facts = scenarioFacts.get(atom.scenarioId);
    const plan = planOfAtom({ atom, plans });
    return {
      runId: atom.runId,
      executionId: atom.executionId,
      runAt: atom.runAt,
      planSlug: plan?.slug ?? atom.planSlug,
      planName: plan?.name ?? atom.planSlug,
      scenarioId: atom.scenarioId,
      scenarioKey: atom.scenarioKey,
      // A stored scenario reads under its stored name; one that ran from code
      // reads under the name its run carried.
      scenarioName: facts?.name ?? atom.scenarioName ?? atom.scenarioId,
      labels: facts?.labels ?? [],
      targetKey: atom.targetKey,
      targetName: targetNameOf({
        targetKey: atom.targetKey,
        targetNames,
        targetParameters,
      }),
      outcome: atom.outcome,
    };
  });
}

/**
 * The plan of the list an atom belongs to.
 *
 * A stored plan is keyed by its slug on both sides. A set that runs from code
 * has no stored plan: the read keys its atoms by the bare set id, while the
 * list names that set under the external plan slug. Resolving here is what
 * lets a run of such a set open the same row the list draws for it.
 */
function planOfAtom({
  atom,
  plans,
}: {
  atom: ResultAtom;
  plans: Map<string, RunPlan>;
}): RunPlan | undefined {
  return plans.get(atom.planSlug) ?? plans.get(toExternalPlanSlug(atom.planSlug));
}

/**
 * How a target key reads.
 *
 * A platform target is named from the project's agents and prompts. A run
 * pushed from code names its own agent instead, and that name arrives with
 * the runs, so it reaches the map the same way. A run from code that named no
 * agent reads under the default target.
 *
 * A target with parameter overrides is keyed by its reference id and a hash
 * of the overrides. It is named from the reference id, and the overrides
 * read after the name, "prod-agent · model=gpt-5-mini", so the same agent on
 * two sets of parameters reads as two targets wherever it is listed.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */
export function targetNameOf({
  targetKey,
  targetNames,
  targetParameters,
}: {
  targetKey: string;
  targetNames: Map<string, string>;
  /** The parameter overrides the page knows, keyed by target key. */
  targetParameters?: Map<string, RunParameterValues>;
}): string {
  const { referenceId } = splitTargetKey(targetKey);
  const name =
    targetNames.get(targetKey) ??
    targetNames.get(referenceId) ??
    (isCodeTargetKey({ targetKey }) ? CODE_TARGET_NAME : referenceId);
  const parameters = targetParametersLabel({
    runParameters: targetParameters?.get(targetKey),
  });
  return parameters === "" ? name : `${name}${TARGET_LABEL_SEPARATOR}${parameters}`;
}

/**
 * The parameter overrides the page knows, keyed by target key.
 *
 * Fed from everything the page already holds: the targets the window lists,
 * the group rows of a target grouping and the atoms of the drill-down. A key
 * with no overrides is left out, so the map only ever adds to a name.
 */
export function targetParametersOf(
  known: { targetKey: string; targetParameters: RunParameterValues | null }[],
): Map<string, RunParameterValues> {
  const parameters = new Map<string, RunParameterValues>();
  for (const { targetKey, targetParameters } of known) {
    if (!targetParameters || Object.keys(targetParameters).length === 0) continue;
    parameters.set(targetKey, targetParameters);
  }
  return parameters;
}

/**
 * The head of every key built from a name the code that pushed a run
 * reported, which is what keeps such a key apart from a platform reference id.
 */
export const CODE_TARGET_KEY_PREFIX = "code:";

/**
 * True for a target the platform holds no agent or prompt for: the code that
 * pushed the run chose what it ran against. Such a target carries the from
 * code mark wherever it is listed.
 */
export function isCodeTargetKey({ targetKey }: { targetKey: string }): boolean {
  return targetKey === UNKNOWN_TARGET_KEY || targetKey.startsWith(CODE_TARGET_KEY_PREFIX);
}

/**
 * The names a run from code reported, keyed by the target they fold under.
 *
 * Fed from everything the page already holds: the targets the window lists,
 * the group rows and the atoms of the drill-down. A platform target is left
 * out, so a stored agent can never be renamed by what a run reported, and a
 * name that is only the key repeated is left out too, so a run that reported
 * no agent still reads under the default target.
 */
export function codeTargetNames(
  named: { targetKey: string; targetName: string | null }[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of named) {
    const { targetKey, targetName } = row;
    if (!targetName || targetName === targetKey) continue;
    if (!isCodeTargetKey({ targetKey })) continue;
    names.set(targetKey, targetName);
  }
  return names;
}

/** How a row names its targets: "dev-agent vs prod-agent". */
export function targetsLabel(names: string[]): string {
  return names.join(" vs ");
}
