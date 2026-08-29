/**
 * The targets one run went against, in the order and the colours the run
 * detail draws them.
 *
 * A target is an agent and its parameters, so the same agent can appear
 * twice in one run. Each target is read off the runs themselves: the key the
 * platform stamped, the reference id behind it and the parameter overrides,
 * so an old run that carried only a reference id reads as one target the
 * way it always did.
 *
 * The order is the sorted order of the run dialog, rebuilt from the same
 * sort key, so the columns of the run keep the order the rows had. The
 * colour is the position, so a target reads in one colour on the dialog, on
 * the table, on the charts and in the runs rail.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { useMemo } from "react";
import {
  computeGroupSummary,
  groupRunsByTargetKey,
  type RunGroupSummary,
  targetKeyOfRun,
} from "~/components/suites/run-history-transforms";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import type { RunParameterValues } from "~/server/scenarios/parameters";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import {
  repeatedReferenceIds,
  targetLabelOf,
  targetSortKey,
} from "~/server/suites/target-key";
import { targetColor } from "../shared/target-colors";

/** One target of a run, as the run detail reads it. */
export type BatchTarget = {
  /** What the target's runs fold under. */
  key: string;
  /** The agent or the prompt behind the target. */
  referenceId: string;
  /** The parameter overrides of the target, or null when it carries none. */
  parameters: RunParameterValues | null;
  /** The name of the agent or the prompt, or the reference id when unknown. */
  name: string;
  /** The name, with the parameters when the same agent appears more than once. */
  label: string;
  color: string;
};

/** True when the run went against more than one target. */
export function isComparison(targets: readonly BatchTarget[]): boolean {
  return targets.length > 1;
}

/** The runs of the batch that went against this target. */
export function runsOfTarget({
  scenarioRuns,
  target,
}: {
  scenarioRuns: ScenarioRunData[];
  target: Pick<BatchTarget, "key">;
}): ScenarioRunData[] {
  return scenarioRuns.filter((run) => targetKeyOfRun(run) === target.key);
}

/**
 * How one target did inside a batch: the pass rate, the cost, the duration
 * and the latency of its runs alone, on the same formula every other group
 * of runs is summed with.
 */
export function summaryOfTarget({
  scenarioRuns,
  target,
}: {
  scenarioRuns: ScenarioRunData[];
  target: Pick<BatchTarget, "key">;
}): RunGroupSummary {
  return computeGroupSummary({
    group: {
      groupKey: target.key,
      groupLabel: target.key,
      groupType: "target",
      timestamp: 0,
      scenarioRuns: runsOfTarget({ scenarioRuns, target }),
    },
  });
}

/** What one target's runs say about it, read off the first of them. */
function targetFactsOf(run: ScenarioRunData): {
  type: string;
  referenceId: string;
  parameters: RunParameterValues | null;
} | null {
  const langwatch = run.metadata?.langwatch;
  if (!langwatch?.targetReferenceId) return null;
  const parameters = langwatch.targetParameters;
  return {
    type: langwatch.targetType,
    referenceId: langwatch.targetReferenceId,
    parameters:
      parameters && Object.keys(parameters).length > 0 ? parameters : null,
  };
}

/**
 * The targets of a batch, sorted and coloured.
 *
 * A run that names no target at all is left out: it has no column to stand
 * in, and a batch of such runs reads as it did before targets existed.
 */
export function batchTargetsOf({
  scenarioRuns,
  targetNameMap,
}: {
  scenarioRuns: ScenarioRunData[];
  targetNameMap: ReadonlyMap<string, string>;
}): BatchTarget[] {
  const facts = groupRunsByTargetKey({ runs: scenarioRuns })
    .map((group) => {
      const first = group.scenarioRuns[0];
      const known = first ? targetFactsOf(first) : null;
      return known ? { key: group.groupKey, ...known } : null;
    })
    .filter((target) => target !== null);

  const sorted = [...facts].sort((left, right) =>
    targetSortKey({
      type: left.type,
      referenceId: left.referenceId,
      runParameters: left.parameters ?? undefined,
    }).localeCompare(
      targetSortKey({
        type: right.type,
        referenceId: right.referenceId,
        runParameters: right.parameters ?? undefined,
      }),
    ),
  );

  const repeated = repeatedReferenceIds(sorted);

  return sorted.map((target, index) => {
    const name = targetNameMap.get(target.referenceId) ?? target.referenceId;
    return {
      key: target.key,
      referenceId: target.referenceId,
      parameters: target.parameters,
      name,
      label: targetLabelOf({
        name,
        runParameters: target.parameters ?? undefined,
        duplicated: repeated.has(target.referenceId),
      }),
      color: targetColor(index),
    };
  });
}

/** The targets of the runs given, named from the project's agents and prompts. */
export function useBatchTargets(
  scenarioRuns: ScenarioRunData[],
): BatchTarget[] {
  const targetNameMap = useTargetNameMap();
  return useMemo(
    () => batchTargetsOf({ scenarioRuns, targetNameMap }),
    [scenarioRuns, targetNameMap],
  );
}
