import { updateScenario as apiUpdateScenario } from "../langwatch-api-scenarios.js";

/**
 * Handles the platform_update_scenario MCP tool invocation.
 *
 * Updates an existing scenario and returns a confirmation
 * with the updated details.
 */
export async function handleUpdateScenario(params: {
  scenarioId: string;
  name?: string;
  situation?: string;
  criteria?: string[];
  labels?: string[];
}): Promise<string> {
  const { scenarioId, ...data } = params;
  const result = await apiUpdateScenario({ id: scenarioId, ...data });

  const lines: string[] = [];
  lines.push("Scenario updated successfully!\n");
  lines.push(`**ID**: ${result.id}`);
  lines.push(`**Name**: ${result.name}`);
  if (result.situation) lines.push(`**Situation**: ${result.situation}`);
  if (Array.isArray(result.criteria) && result.criteria.length > 0) {
    lines.push(`**Criteria**: ${result.criteria.length} criteria`);
  }
  if (Array.isArray(result.labels) && result.labels.length > 0) {
    lines.push(`**Labels**: ${result.labels.join(", ")}`);
  }

  return lines.join("\n");
}
