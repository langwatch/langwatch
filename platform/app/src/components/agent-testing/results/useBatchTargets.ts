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
import {
  type TargetIdentity,
  useTargetIdentityMap,
} from "~/hooks/useTargetNameMap";
import type { RunParameterValues } from "~/server/scenarios/parameters";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import {
  differingParameterNames,
  targetLabels,
  targetParametersLabel,
  targetSortKey,
} from "~/server/suites/target-key";
import type { TargetKind } from "../shared/TargetMark";
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
  /** The kind of agent behind the target, for the mark that leads its rows. */
  kind: TargetKind;
  /**
   * The name, with the parameters that differ from the other targets of the
   * same agent when the agent appears more than once.
   */
  label: string;
  /**
   * What reads where there is room for a word or two, under a bar: the
   * differing parameters alone when the agent appears more than once,
   * `default` for the one of them that carries none, or the name.
   */
  shortLabel: string;
  /**
   * The environment of a connected agent, with its owner when it has one:
   * `production`, or `development (Ana)`. Null for every other target.
   */
  environmentLabel: string | null;
  color: string;
};

/** What a repeated agent's target with no differing parameter reads as. */
export const DEFAULT_TARGET_SHORT_LABEL = "default";

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
  targetIdentities,
}: {
  scenarioRuns: ScenarioRunData[];
  /** What each reference id stands for: its name, environment and owner. */
  targetIdentities: ReadonlyMap<string, TargetIdentity>;
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

  const identityOf = (target: { referenceId: string }) =>
    targetIdentities.get(target.referenceId);
  const nameOf = (target: { referenceId: string }) =>
    identityOf(target)?.name ?? target.referenceId;
  const environmentOf = (target: { referenceId: string }) =>
    identityOf(target)?.environment ?? null;
  const ownerNameOf = (target: { referenceId: string }) =>
    identityOf(target)?.ownerName ?? null;
  const kindOf = (target: { referenceId: string }): TargetKind =>
    identityOf(target)?.kind ?? "unknown";
  const labelled = sorted.map((target) => ({
    referenceId: target.referenceId,
    runParameters: target.parameters ?? undefined,
  }));
  const labels = targetLabels({
    targets: labelled,
    nameOf,
    environmentOf,
    ownerNameOf,
  });
  const differing = differingParameterNames(labelled);
  const repeated = new Set(
    labelled
      .map((target) => target.referenceId)
      .filter((id, at, ids) => ids.indexOf(id) !== at),
  );

  return sorted.map((target, index) => ({
    key: target.key,
    referenceId: target.referenceId,
    parameters: target.parameters,
    name: nameOf(target),
    kind: kindOf(target),
    label: labels[index] ?? nameOf(target),
    shortLabel: repeated.has(target.referenceId)
      ? targetParametersLabel({
          runParameters: target.parameters ?? undefined,
          names: differing.get(target.referenceId),
        }) || DEFAULT_TARGET_SHORT_LABEL
      : nameOf(target),
    environmentLabel: environmentLabelOf(identityOf(target)),
    color: targetColor(index),
  }));
}

/** `production`, or `development (Ana)`; nothing when there is no environment. */
function environmentLabelOf(
  identity: TargetIdentity | undefined,
): string | null {
  if (!identity?.environment) return null;
  return identity.ownerName
    ? `${identity.environment} (${identity.ownerName})`
    : identity.environment;
}

/** The targets of the runs given, named from the project's agents and prompts. */
export function useBatchTargets(
  scenarioRuns: ScenarioRunData[],
): BatchTarget[] {
  const targetIdentities = useTargetIdentityMap();
  return useMemo(
    () => batchTargetsOf({ scenarioRuns, targetIdentities }),
    [scenarioRuns, targetIdentities],
  );
}
