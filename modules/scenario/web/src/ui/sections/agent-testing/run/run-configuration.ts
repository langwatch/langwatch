/**
 * What a run is configured with, and how one configuration is told from another.
 * @see specs/features/agent-testing/run-dialog.feature
 */

import type { RunParameterValues } from "@langwatch/scenario-contract";
import {
  configurationKey,
  scopeKey,
  targetLabels as labelTargets,
  targetSortKey,
} from "@langwatch/suite-contract";
import type { SuiteScope, SuiteTarget } from "@langwatch/suite-contract";

/**
 * What a run covers, as the dialog holds it.
 */
export type RunScope =
  | { mode: "all" }
  | { mode: "test_suites"; testSuiteIds: string[] }
  | { mode: "labels"; labels: string[] }
  | { mode: "scenarios"; scenarioIds: string[] };

/** The scope as the server stores it: the rule, without the hand-picked list. */
export function toSuiteScope(scope: RunScope): SuiteScope {
  if (scope.mode === "scenarios") return { mode: "scenarios" };
  return scope;
}

/**
 * A list of every test suite reads as "all scenarios".
 */
export function normaliseRunScope({
  scope,
  allTestSuiteIds,
}: {
  scope: RunScope;
  allTestSuiteIds: readonly string[];
}): RunScope {
  if (scope.mode !== "test_suites" || allTestSuiteIds.length === 0) return scope;
  const chosen = new Set(scope.testSuiteIds);
  const coversEverything = allTestSuiteIds.every((id) => chosen.has(id));
  return coversEverything ? { mode: "all" } : scope;
}

/** Everything a picked entry puts back into the dialog. */
export type RunConfiguration = {
  scope: RunScope;
  /** Stably sorted, so "dev vs prod" and "prod vs dev" are one configuration. */
  targets: SuiteTarget[];
  repeatCount: number;
  simulatorModel: string | null;
  judgeModel: string | null;
};

/** One line of the run name dropdown. */
export type RunConfigurationEntry = {
  /** One key per configuration, not per plan. */
  key: string;
  planId: string;
  planName: string;
  configuration: RunConfiguration;
  /** The parameter overrides this configuration was run with. */
  runParameters: RunParameterValues;
  /**
   * Whether a run of this configuration carried a note.
   */
  usesNote?: boolean;
  /** Newest-first ordering, and the age the row reads. */
  lastRunAt: Date | null;
};

/**
 * Targets in a stable order, whichever order they were picked in.
 */
export function sortTargets(targets: readonly SuiteTarget[]): SuiteTarget[] {
  return [...targets].sort((left, right) =>
    targetSortKey(left).localeCompare(targetSortKey(right)),
  );
}

/**
 * What the targets are called, in sorted order.
 */
export function sortedTargetLabels({
  targets,
  targetLabels,
  fallbackLabel,
}: {
  targets: readonly SuiteTarget[];
  targetLabels: ReadonlyMap<string, string>;
  /** What a target the project no longer offers reads as. */
  fallbackLabel: (target: SuiteTarget) => string;
}): string[] {
  return labelTargets({
    targets: sortTargets(targets),
    nameOf: (target) => targetLabels.get(target.referenceId) ?? fallbackLabel(target),
  });
}

/** The scenarios a rule names inside itself, which only a hand-picked one does. */
function scenarioIdsOf(scope: RunScope): string[] | undefined {
  return scope.mode === "scenarios" ? scope.scenarioIds : undefined;
}

/** A scope as one string, so two scopes can be compared. */
export function scopeKeyOf(scope: RunScope): string {
  return scopeKey({
    scope: toSuiteScope(scope),
    scenarioIds: scenarioIdsOf(scope),
  });
}

/**
 * The identity of a configuration.
 */
export function configurationKeyOf({
  configuration,
  runParameters,
}: {
  configuration: RunConfiguration;
  runParameters: RunParameterValues;
}): string {
  return configurationKey({
    config: {
      scope: toSuiteScope(configuration.scope),
      targets: [...configuration.targets],
      repeatCount: configuration.repeatCount,
      simulatorModel: configuration.simulatorModel,
      judgeModel: configuration.judgeModel,
    },
    scenarioIds: scenarioIdsOf(configuration.scope),
    parameters: runParameters,
  });
}

/**
 * The derived run name: the scope, then the targets it goes against.
 */
export function deriveRunName({
  scopeLabel,
  targetLabels,
}: {
  scopeLabel: string;
  targetLabels: readonly string[];
}): string {
  const targets = targetLabels.filter((label) => label.length > 0);
  if (targets.length === 0) return scopeLabel;
  return `${scopeLabel} ${targets.join(" vs ")}`;
}

/**
 * What a target that the project no longer offers reads as.
 */
function removedLabel(target: SuiteTarget): string {
  return target.type === "prompt" ? "a removed prompt" : "a removed agent";
}

/** One fact about a configuration, as the dropdown row reads it. */
type ConfigurationFacts = {
  targets: string;
  parameters: string;
  repeat: string;
  models: string;
};

/** Every fact a row could state, whether or not it is worth stating. */
function factsOf({
  entry,
  targetLabels,
}: {
  entry: RunConfigurationEntry;
  targetLabels: ReadonlyMap<string, string>;
}): ConfigurationFacts {
  const configuration = entry.configuration;
  const parameterNames = Object.keys(entry.runParameters).sort();
  const models = [configuration.simulatorModel, configuration.judgeModel]
    .filter((model): model is string => !!model)
    .join(", ");

  return {
    targets: sortedTargetLabels({
      targets: configuration.targets,
      targetLabels,
      fallbackLabel: removedLabel,
    }).join(" vs "),
    parameters: parameterNames
      .map((name) => `${name}=${entry.runParameters[name] ?? ""}`)
      .join(", "),
    repeat: configuration.repeatCount > 1 ? `${configuration.repeatCount} runs each` : "",
    models,
  };
}

/**
 * What tells one entry from another that carries the same plan name.
 */
export function describeConfigurations({
  entries,
  targetLabels,
}: {
  entries: readonly RunConfigurationEntry[];
  targetLabels: ReadonlyMap<string, string>;
}): Map<string, string> {
  const facts = new Map(entries.map((entry) => [entry.key, factsOf({ entry, targetLabels })]));
  const described = new Map<string, string>();

  for (const entry of entries) {
    const sameName = entries.filter((other) => other.planName === entry.planName);
    const own = facts.get(entry.key);
    if (!own) continue;

    const differing = (["targets", "parameters", "repeat", "models"] as const)
      .filter((fact) =>
        // An entry alone under its name still states its targets, so the row
        // says what it runs against rather than nothing at all.
        fact === "targets"
          ? true
          : sameName.some((other) => facts.get(other.key)?.[fact] !== own[fact]),
      )
      .map((fact) => own[fact])
      .filter((value) => value.length > 0);

    described.set(entry.key, differing.join(" · "));
  }

  return described;
}

/**
 * The configurations of one scope, newest first, one per configuration.
 */
export function configurationsForScope({
  entries,
  scope,
}: {
  entries: readonly RunConfigurationEntry[];
  scope: RunScope;
}): RunConfigurationEntry[] {
  const wanted = scopeKeyOf(scope);
  const collapsed = new Map<string, RunConfigurationEntry>();

  for (const entry of entries) {
    if (scopeKeyOf(entry.configuration.scope) !== wanted) continue;
    const seen = collapsed.get(entry.key);
    if (!seen) {
      collapsed.set(entry.key, entry);
      continue;
    }
    if ((entry.lastRunAt?.getTime() ?? 0) > (seen.lastRunAt?.getTime() ?? 0)) {
      collapsed.set(entry.key, entry);
    }
  }

  return [...collapsed.values()].sort(
    (left, right) => (right.lastRunAt?.getTime() ?? 0) - (left.lastRunAt?.getTime() ?? 0),
  );
}
