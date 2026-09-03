/**
 * A run plan's config, and the keys that compare two of them.
 *
 * A run plan is a NAME plus a config. The name is the plan's identity: a run
 * started under a name joins the plan of that name and replaces its config, or
 * creates the plan when nothing answers. The keys here never take part in that
 * identity. They answer a different question: "which stored configurations does
 * this scope already have history for", which the run dialog's Run name
 * autocomplete reads.
 *
 * So: two plans may hold the SAME config and differ only by name. Nothing may
 * derive a plan's id or slug from a config key.
 *
 * `normalizePlanScope` takes the project's active test suite ids as a plain
 * argument rather than reading them itself, so it stays framework-free: the
 * caller reads them from `ScenarioService.listTestSuites` first.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */

import type { RunParameterValues } from "@langwatch/scenario-contract";
import { type SuiteScope, suiteScopeSchema } from "./suite.scope";
import { targetIdentityKey, targetSortKey } from "./target-key";
import type { SuiteTarget } from "./suite";

/** Everything a run plan holds beside its name. */
export type PlanConfig = {
  scope: SuiteScope;
  targets: SuiteTarget[];
  repeatCount: number;
  simulatorModel: string | null;
  judgeModel: string | null;
};

/**
 * Orders targets so "dev vs prod" and "prod vs dev" are one config.
 *
 * Stable and total: `type`, then the reference id, then the parameter
 * overrides, all of which every target carries (see `targetSortKey`).
 * Comparison columns therefore keep their order between runs of the same
 * plan, and a plain agent sorts before the same agent with overrides.
 */
export function sortSuiteTargets(targets: SuiteTarget[]): SuiteTarget[] {
  return [...targets].sort((left, right) =>
    targetSortKey(left).localeCompare(targetSortKey(right)),
  );
}

/**
 * The targets that appear more than once in a config, one per repeated one.
 *
 * Two targets of one agent with the same overrides would run the same thing
 * twice under one column, so a config holding any is refused. The same agent
 * with different overrides is two targets, and is fine.
 *
 * Two targets are the same one when `targetIdentityKey` says so, which reads
 * the overrides as JSON. The readable sort key cannot answer this: a value
 * that holds a comma and an `=` writes the pairs another target writes.
 */
export function duplicateSuiteTargets(targets: SuiteTarget[]): SuiteTarget[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const duplicates: SuiteTarget[] = [];
  for (const target of targets) {
    const key = targetIdentityKey(target);
    if (seen.has(key) && !reported.has(key)) {
      duplicates.push(target);
      reported.add(key);
    }
    seen.add(key);
  }
  return duplicates;
}

/**
 * What a scope covers, as one comparable string.
 *
 * `scenarios` folds in the scenario ids, which the scope shape itself does not
 * carry (they live in `SimulationSuite.scenarioIds`). Without them two
 * hand-picked scopes over different scenarios would take the same key and offer
 * each other the wrong history.
 */
export function scopeKey(params: { scope: SuiteScope; scenarioIds?: string[] }): string {
  const { scope } = params;
  switch (scope.mode) {
    case "all":
      return "all";
    case "test_suites":
      return `testSuites:${sortedList(scope.testSuiteIds)}`;
    case "labels":
      return `labels:${sortedList(scope.labels)}`;
    case "scenarios":
      return `scenarios:${sortedList(params.scenarioIds ?? [])}`;
  }
}

/**
 * One configuration, as one comparable string.
 *
 * Configuration identity is WIDER than plan identity: one plan run twice with
 * different parameters, or a different repeat count, is two configurations and
 * both are listed. The run NOTE is never part of it, and is never carried over.
 *
 * The recipe is shared with the run dialog, which rebuilds the same string to
 * mark the entry matching what it currently holds, so the field order and the
 * separators below are a contract and not an implementation detail.
 */
export function configurationKey(params: {
  config: PlanConfig;
  scenarioIds?: string[];
  parameters?: RunParameterValues;
}): string {
  const { config } = params;
  return [
    scopeKey({ scope: config.scope, scenarioIds: params.scenarioIds }),
    sortSuiteTargets(config.targets).map(targetIdentityKey).join("+"),
    `x${config.repeatCount}`,
    config.simulatorModel ?? "",
    config.judgeModel ?? "",
    parametersKey(params.parameters),
  ].join("|");
}

/**
 * The parameter overrides a run was started with, as `k=v` pairs.
 *
 * A parameter value is a string, a number or a boolean, so the key states the
 * value the way JavaScript prints it. A number and the string of that number
 * therefore take one key, which is correct here: both name the same run.
 */
export function parametersKey(parameters: RunParameterValues | undefined): string {
  return Object.entries(parameters ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .sort()
    .join(",");
}

function sortedList(values: string[]): string {
  return [...new Set(values)].sort().join(",");
}

/** Reads a stored scope back, refusing nothing: see parseSuiteScope. */
export function planScopeOrNull(raw: unknown): SuiteScope | null {
  const parsed = suiteScopeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Reduces a scope to the one form the project agrees on.
 *
 * A `test suites` scope naming every active test suite of the project IS
 * every scenario of the project, so it normalises to `all` — without this,
 * hand-picking every suite and pressing Run all land on two different plans
 * that always run the same thing. A scope naming no suite is left alone: an
 * empty pick is not everything.
 */
export function normalizePlanScope({
  scope,
  activeTestSuiteIds,
}: {
  scope: SuiteScope;
  activeTestSuiteIds: string[];
}): SuiteScope {
  if (scope.mode !== "test_suites") return scope;

  const named = new Set(scope.testSuiteIds);
  if (named.size === 0) return { mode: "test_suites", testSuiteIds: [] };

  const coversEvery =
    activeTestSuiteIds.length > 0 && activeTestSuiteIds.every((id) => named.has(id));
  return coversEvery
    ? { mode: "all" }
    : { mode: "test_suites", testSuiteIds: [...named].sort() };
}
