// Run plan config and comparison keys.

import type { RunParameterValues } from "@langwatch/scenario-contract";

import type { SuiteScope } from "./suite.scope.ts";
import type { SuiteTarget } from "./suite.ts";
import { targetIdentityKey, targetSortKey } from "./target-key.ts";

/** Everything a run plan holds beside its name. */
export type PlanConfig = {
  scope: SuiteScope;
  targets: SuiteTarget[];
  repeatCount: number;
  simulatorModel: string | null;
  judgeModel: string | null;
};

/**
 * Orders targets so "dev vs prod" and "prod vs dev" are one config: stable
 * and total by `type`, reference id, then overrides (see `targetSortKey`).
 * Columns keep order between runs; a plain agent sorts before its overridden twin.
 */
export function sortSuiteTargets(targets: SuiteTarget[]): SuiteTarget[] {
  return [...targets].toSorted((left, right) =>
    targetSortKey(left).localeCompare(targetSortKey(right)),
  );
}

// Duplicate targets in a config (same agent with identical overrides).
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

// Scope as one comparable string, including scenario ids.
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

// Configuration as one comparable string (wider than plan identity).
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

// Parameter overrides as `k=v` pairs.
export function parametersKey(parameters: RunParameterValues | undefined): string {
  return Object.entries(parameters ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .toSorted()
    .join(",");
}

function sortedList(values: string[]): string {
  return [...new Set(values)].toSorted().join(",");
}

// Normalize scope: all test suites becomes "all" mode.
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
    : { mode: "test_suites", testSuiteIds: [...named].toSorted() };
}
