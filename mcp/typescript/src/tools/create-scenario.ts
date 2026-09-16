import { createScenario as apiCreateScenario } from "../langwatch-api-scenarios.js";
import type { ScenarioFieldValues } from "../schemas/suite-fields.js";
import { formatScenarioFields } from "./format-scenario.js";

/**
 * Handles the platform_create_scenario MCP tool: creates a scenario and
 * returns a confirmation with its details.
 */
export async function handleCreateScenario(params: {
  name: string;
  situation: string;
  criteria?: string[];
  labels?: string[];
  testSuiteId?: string | null;
  fields?: ScenarioFieldValues;
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
  if (result.testSuiteId) {
    lines.push(`**Test suite**: ${result.testSuiteId}`);
  }
  lines.push(...formatScenarioFields(result.fields));

  return lines.join("\n");
}
