import { updateSuite as apiUpdateSuite } from "../langwatch-api-suites.js";
import type { SuiteTarget } from "../langwatch-api-suites.js";

/**
 * Handles the platform_update_suite MCP tool invocation.
 */
export async function handleUpdateSuite(params: {
  id: string;
  name?: string;
  description?: string;
  scenarioIds?: string[];
  targets?: string;
  repeatCount?: number;
  labels?: string[];
}): Promise<string> {
  let parsedTargets: SuiteTarget[] | undefined;
  if (params.targets) {
    try {
      parsedTargets = JSON.parse(params.targets) as SuiteTarget[];
    } catch {
      return "Error: `targets` must be a valid JSON array.";
    }
  }

  const suite = await apiUpdateSuite({
    id: params.id,
    name: params.name,
    description: params.description,
    scenarioIds: params.scenarioIds,
    targets: parsedTargets,
    repeatCount: params.repeatCount,
    labels: params.labels,
  });

  return [
    `Suite "${suite.name}" updated successfully.`,
    "",
    `**ID**: ${suite.id}`,
    `**Slug**: ${suite.slug}`,
    `**Scenarios**: ${suite.scenarioIds.length}`,
    `**Targets**: ${suite.targets.length}`,
    `**Repeat**: ${suite.repeatCount}x`,
  ].join("\n");
}
