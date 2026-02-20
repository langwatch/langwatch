import { createScenario as apiCreateScenario } from "../langwatch-api-scenarios.js";

/**
 * Handles the create_scenario MCP tool invocation.
 *
 * Creates a new scenario in the LangWatch project and returns a
 * confirmation with the created scenario's details.
 */
export async function handleCreateScenario(params: {
  name: string;
  situation: string;
  criteria?: string[];
  labels?: string[];
}): Promise<string> {
  const result = await apiCreateScenario(params);

  const lines: string[] = [];
  lines.push("Scenario created successfully!\n");
  lines.push(`**ID**: ${result.id}`);
  lines.push(`**Name**: ${result.name}`);
  lines.push(`**Situation**: ${result.situation}`);
  if (Array.isArray(result.criteria) && result.criteria.length > 0) {
    lines.push(`**Criteria**: ${result.criteria.length} criteria`);
  }
  if (Array.isArray(result.labels) && result.labels.length > 0) {
    lines.push(`**Labels**: ${result.labels.join(", ")}`);
  }

  return lines.join("\n");
}
