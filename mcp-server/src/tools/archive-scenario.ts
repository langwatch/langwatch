import { archiveScenario as apiArchiveScenario } from "../langwatch-api-scenarios.js";

/**
 * Handles the platform_archive_scenario MCP tool invocation.
 *
 * Archives (soft-deletes) a scenario and returns confirmation.
 */
export async function handleArchiveScenario(params: {
  scenarioId: string;
}): Promise<string> {
  const result = await apiArchiveScenario(params.scenarioId);

  const lines: string[] = [];
  lines.push("Scenario archived successfully!\n");
  lines.push(`**ID**: ${result.id}`);
  lines.push(`**Status**: ${result.archived ? "archived" : "active"}`);

  return lines.join("\n");
}
