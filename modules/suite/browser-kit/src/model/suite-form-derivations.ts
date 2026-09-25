import type { FieldMapping } from "@langwatch/scenario-contract";
import {
  type SuiteScope,
  type SuiteScopeMode,
  type SuiteTarget,
  suiteTargetSchema,
} from "@langwatch/suite-contract";
import { z } from "zod";

import type {
  SuiteFormAgent,
  SuiteFormAvailableTarget,
  SuiteFormPrompt,
  SuiteFormScenario,
  SuiteFormSuite,
  suiteFormSchema,
} from "./suite-form.types.ts";

export function getAvailableTargets(
  agents: SuiteFormAgent[] | undefined,
  prompts: SuiteFormPrompt[] | undefined,
): SuiteFormAvailableTarget[] {
  const result: SuiteFormAvailableTarget[] = [];

  for (const agent of agents ?? []) {
    if (agent.type !== "http" && agent.type !== "code" && agent.type !== "workflow") {
      continue;
    }
    result.push({
      name: agent.name,
      type: agent.type,
      referenceId: agent.id,
    });
  }

  for (const prompt of prompts ?? []) {
    result.push({
      name: prompt.handle ?? prompt.id,
      type: "prompt",
      referenceId: prompt.id,
    });
  }

  return result;
}

export function getArchivedScenarioIds(
  selectedScenarioIds: string[],
  scenarios: SuiteFormScenario[] | undefined,
) {
  if (!scenarios) return [];

  const activeIds = new Set(scenarios.map((scenario) => scenario.id));
  return selectedScenarioIds.filter((id) => !activeIds.has(id)).map((id) => ({ id, name: id }));
}

export function getArchivedTargets(
  selectedTargets: SuiteTarget[],
  availableTargets: SuiteFormAvailableTarget[],
  agents: SuiteFormAgent[] | undefined,
  prompts: SuiteFormPrompt[] | undefined,
) {
  if (!agents || !prompts) return [];

  return selectedTargets
    .filter(
      (target) =>
        !availableTargets.some(
          (availableTarget) =>
            availableTarget.type === target.type &&
            availableTarget.referenceId === target.referenceId,
        ),
    )
    .map((target) => ({ ...target, name: target.referenceId }));
}

export function getAllLabels(scenarios: SuiteFormScenario[] | undefined) {
  if (!scenarios) return [];

  const labelSet = new Set<string>();
  for (const scenario of scenarios) {
    for (const label of scenario.labels) {
      labelSet.add(label);
    }
  }
  return Array.from(labelSet).toSorted();
}

export function filterScenarios(
  scenarios: SuiteFormScenario[] | undefined,
  search: string,
  activeLabelFilter: string | null,
) {
  if (!scenarios) return [];

  let filtered = scenarios;
  if (search.trim()) {
    const query = search.toLowerCase();
    filtered = filtered.filter((scenario) => scenario.name.toLowerCase().includes(query));
  }
  if (activeLabelFilter) {
    filtered = filtered.filter((scenario) => scenario.labels.includes(activeLabelFilter));
  }
  return filtered;
}

export function filterTargets(availableTargets: SuiteFormAvailableTarget[], search: string) {
  if (!search.trim()) return availableTargets;

  const query = search.toLowerCase();
  return availableTargets.filter((target) => target.name.toLowerCase().includes(query));
}

export const isSameTarget = (
  a: Pick<SuiteTarget, "type" | "referenceId">,
  b: Pick<SuiteTarget, "type" | "referenceId">,
) => a.type === b.type && a.referenceId === b.referenceId;

export function withTargetMapping({
  target,
  identifier,
  mapping,
}: {
  target: SuiteTarget;
  identifier: string;
  mapping: FieldMapping | undefined;
}): SuiteTarget {
  const mappings = { ...target.scenarioMappings };
  if (mapping) {
    mappings[identifier] = mapping;
  } else {
    delete mappings[identifier];
  }

  return {
    ...target,
    scenarioMappings: Object.keys(mappings).length > 0 ? mappings : undefined,
  };
}

/**
 * The scenarios the scope covers, from lists the form already holds — the same rule the run
 * resolves against the database, so the picker's count matches what the run will cover.
 */
export function scopedScenarioIdsOf({
  scenarios,
  scope,
  selectedScenarioIds,
}: {
  scenarios: SuiteFormScenario[] | undefined;
  scope: SuiteScope;
  selectedScenarioIds: string[];
}): string[] {
  const active = scenarios ?? [];
  if (scope.mode === "all") return active.map((scenario) => scenario.id);
  if (scope.mode === "test_suites") {
    return active
      .filter(
        (scenario) => !!scenario.testSuiteId && scope.testSuiteIds.includes(scenario.testSuiteId),
      )
      .map((scenario) => scenario.id);
  }
  if (scope.mode === "labels") {
    return active
      .filter((scenario) => scenario.labels.some((label) => scope.labels.includes(label)))
      .map((scenario) => scenario.id);
  }
  return selectedScenarioIds;
}

/** The scope a mode switch lands on, giving back what that mode last held. */
export function scopeForMode({
  mode,
  rememberedTestSuiteIds,
  rememberedLabels,
}: {
  mode: SuiteScopeMode;
  rememberedTestSuiteIds: string[];
  rememberedLabels: string[];
}): SuiteScope {
  if (mode === "all" || mode === "scenarios") return { mode };
  if (mode === "test_suites") return { mode, testSuiteIds: rememberedTestSuiteIds };
  return { mode, labels: rememberedLabels };
}

/** The list with `value` removed when present, appended when not. */
export function toggledValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function toggledTarget<T extends Pick<SuiteTarget, "type" | "referenceId">>(
  list: T[],
  target: T,
): T[] {
  const exists = list.some((candidate) => isSameTarget(candidate, target));
  return exists ? list.filter((candidate) => !isSameTarget(candidate, target)) : [...list, target];
}

export function targetsWithMapping({
  targets,
  target,
  identifier,
  mapping,
}: {
  targets: SuiteTarget[];
  target: SuiteTarget;
  identifier: string;
  mapping: FieldMapping | undefined;
}): SuiteTarget[] {
  return targets.map((candidate) =>
    isSameTarget(candidate, target)
      ? withTargetMapping({ target: candidate, identifier, mapping })
      : candidate,
  );
}

/** The per-mode lists a stored scope seeds the form's memory with. */
export function rememberedScopeOf(scope: SuiteScope): { testSuiteIds: string[]; labels: string[] } {
  return {
    testSuiteIds: scope.mode === "test_suites" ? scope.testSuiteIds : [],
    labels: scope.mode === "labels" ? scope.labels : [],
  };
}

export function suiteFormValuesOf({
  suite,
  scope,
}: {
  suite: SuiteFormSuite;
  scope: SuiteScope;
}): z.input<typeof suiteFormSchema> {
  return {
    scope,
    name: suite.name,
    description: suite.description ?? "",
    labels: suite.labels,
    selectedScenarioIds: suite.scenarioIds,
    selectedTargets: z.array(suiteTargetSchema).parse(suite.targets),
    repeatCount: suite.repeatCount,
    simulatorModel: suite.simulatorModel,
    judgeModel: suite.judgeModel,
  };
}
