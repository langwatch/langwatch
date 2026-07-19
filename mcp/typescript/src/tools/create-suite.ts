import { createSuite as apiCreateSuite } from "../langwatch-api-suites.js";
import type { SuiteTarget } from "../langwatch-api-suites.js";

/**
 * Handles the platform_create_suite MCP tool invocation.
 */
export async function handleCreateSuite(params: {
  name: string;
  description?: string;
  scenarioIds: string[];
  targets: string;
  repeatCount?: number;
  labels?: string[];
}): Promise<string> {
  let parsedTargets: SuiteTarget[];
  try {
    parsedTargets = JSON.parse(params.targets) as SuiteTarget[];
  } catch {
    return "Error: `targets` must be a valid JSON array of objects with `type` and `referenceId` fields.\n\nExample: [{\"type\": \"http\", \"referenceId\": \"agent_abc123\"}]";
  }

  const suite = await apiCreateSuite({
    name: params.name,
    description: params.description,
    scenarioIds: params.scenarioIds,
    targets: parsedTargets,
    repeatCount: params.repeatCount,
    labels: params.labels,
  });

  return [
    `Suite "${suite.name}" created successfully.`,
    "",
    `**ID**: ${suite.id}`,
    `**Slug**: ${suite.slug}`,
    `**Scenarios**: ${suite.scenarioIds.length}`,
    `**Targets**: ${suite.targets.length}`,
    `**Repeat**: ${suite.repeatCount}x`,
    "",
    `> Use \`platform_run_suite\` with ID \`${suite.id}\` to trigger execution.`,
  ].join("\n");
}
