/**
 * The client side of the atom: what the filter row asks for, and how a stored atom becomes a row a person can read.
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
