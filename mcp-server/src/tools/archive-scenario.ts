import { archiveScenario as apiArchiveScenario } from "../langwatch-api.js";

/**
 * Handles the archive_scenario MCP tool invocation.
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
  lines.push(`**Status**: archived`);

  return lines.join("\n");
}
