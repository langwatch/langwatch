/**
 * What a run is configured with, and how one configuration is told from
 * another.
 *
 * A configuration is the scope, the targets, the repeat count and the
 * simulation models. Identity is wider than plan identity: one plan that ran
 * twice with different parameter overrides or a different repeat count holds
 * two configurations, and both are offered again. The note is never part of a
 * configuration, so it is neither stored here nor carried back.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import type { RunParameterValues } from "~/server/scenarios/parameters";
import {
  configurationKey,
  scopeKey,
  sortSuiteTargets,
} from "~/server/suites/plan-config";
import type { SuiteScope } from "~/server/suites/scope";
import type { SuiteTarget } from "~/server/suites/types";

/**
 * What a run covers, as the dialog holds it.
 *
 * The stored scope names no scenarios, because a plan keeps its hand-picked list
 * in its own `scenarioIds`. The dialog needs the list inside the rule, so two
 * hand-picked scopes over different scenarios are two scopes rather than one.
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
 *
 * Without this, ticking every suite by hand lands on a different scope from
 * Run all, and the two offer each other no history.
 */
export function normaliseRunScope({
  scope,
  allTestSuiteIds,
}: {
  scope: RunScope;
  allTestSuiteIds: readonly string[];
}): RunScope {
  if (scope.mode !== "test_suites" || allTestSuiteIds.length === 0)
    return scope;
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
   *
   * The fact, never the note. A run plan that takes a note takes one every
   * run, and the text changes every run.
   */
  usesNote?: boolean;
  /** Newest-first ordering, and the age the row reads. */
  lastRunAt: Date | null;
};

/** Targets in a stable order, whichever order they were picked in. */
export function sortTargets(targets: readonly SuiteTarget[]): SuiteTarget[] {
  return sortSuiteTargets([...targets]);
}

/** The scenarios a rule names inside itself, which only a hand-picked one does. */
function caseIdsOf(scope: RunScope): string[] | undefined {
  return scope.mode === "scenarios" ? scope.scenarioIds : undefined;
}

/** A scope as one string, so two scopes can be compared. */
export function scopeKeyOf(scope: RunScope): string {
  return scopeKey({
    scope: toSuiteScope(scope),
    scenarioIds: caseIdsOf(scope),
  });
}

/**
 * The identity of a configuration.
 *
 * The recipe is the server's, so the string the dialog builds and the string
 * the server builds for the same configuration are one string. The parameters
 * join the key, which is what makes two runs of one plan two entries when they
 * used different overrides.
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
    scenarioIds: caseIdsOf(configuration.scope),
    parameters: runParameters,
  });
}

/**
 * The derived run name: the scope, then the targets it goes against.
 *
 * "Refunds dev-agent vs prod-agent". A run with nothing chosen yet is named
 * after its scope alone.
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
 *
 * A configuration outlives the agent it ran against, and the id of a removed
 * agent means nothing to the person reading the row.
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
    targets: sortTargets(configuration.targets)
      .map(
        (target) =>
          targetLabels.get(target.referenceId) ?? removedLabel(target),
      )
      .join(" vs "),
    parameters: parameterNames
      .map((name) => `${name}=${entry.runParameters[name] ?? ""}`)
      .join(", "),
    repeat:
      configuration.repeatCount > 1
        ? `${configuration.repeatCount} runs each`
        : "",
    models,
  };
}

/**
 * What tells one entry from another that carries the same plan name.
 *
 * Only the facts that differ inside a group of entries sharing a name are
 * worth reading, so an entry that is alone under its name reads its targets
 * and nothing more.
 */
export function describeConfigurations({
  entries,
  targetLabels,
}: {
  entries: readonly RunConfigurationEntry[];
  targetLabels: ReadonlyMap<string, string>;
}): Map<string, string> {
  const facts = new Map(
    entries.map((entry) => [entry.key, factsOf({ entry, targetLabels })]),
  );
  const described = new Map<string, string>();

  for (const entry of entries) {
    const sameName = entries.filter(
      (other) => other.planName === entry.planName,
    );
    const own = facts.get(entry.key);
    if (!own) continue;

    const differing = (["targets", "parameters", "repeat", "models"] as const)
      .filter((fact) =>
        // An entry alone under its name still states its targets, so the row
        // says what it runs against rather than nothing at all.
        fact === "targets"
          ? true
          : sameName.some(
              (other) => facts.get(other.key)?.[fact] !== own[fact],
            ),
      )
      .map((fact) => own[fact])
      .filter((value) => value.length > 0);

    described.set(entry.key, differing.join(" · "));
  }

  return described;
}

/**
 * The configurations of one scope, newest first, one per configuration.
 *
 * Entries of the same configuration collapse onto the newest of them, so a
 * scope run nightly with one setup offers one line rather than thirty.
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
    (left, right) =>
      (right.lastRunAt?.getTime() ?? 0) - (left.lastRunAt?.getTime() ?? 0),
  );
}
