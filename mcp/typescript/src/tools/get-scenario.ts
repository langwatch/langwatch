import { getScenario as apiGetScenario } from "../langwatch-api-scenarios.js";

/**
 * Handles the get_scenario MCP tool invocation.
 *
 * Retrieves a specific scenario by ID and formats it as
 * AI-readable markdown or raw JSON.
 */
export async function handleGetScenario(params: {
  scenarioId: string;
  format?: "digest" | "json";
}): Promise<string> {
  const scenario = await apiGetScenario(params.scenarioId);

  if (params.format === "json") {
    return JSON.stringify(scenario, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Scenario: ${scenario.name}\n`);
  lines.push(`**ID**: ${scenario.id}`);
  lines.push(`**Situation**: ${scenario.situation}`);

  if (Array.isArray(scenario.criteria) && scenario.criteria.length > 0) {
    lines.push("\n## Criteria");
    for (const criterion of scenario.criteria) {
      lines.push(`- ${criterion}`);
    }
  }

  if (Array.isArray(scenario.labels) && scenario.labels.length > 0) {
    lines.push(`\n**Labels**: ${scenario.labels.join(", ")}`);
  }

  return lines.join("\n");
}
