import type { FieldMapping } from "@langwatch/scenario-contract";
import type { SuiteTarget } from "@langwatch/suite-contract";

import type {
  SuiteFormAgent,
  SuiteFormAvailableTarget,
  SuiteFormPrompt,
  SuiteFormScenario,
} from "./suite-form.types";

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
  return Array.from(labelSet).sort();
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
