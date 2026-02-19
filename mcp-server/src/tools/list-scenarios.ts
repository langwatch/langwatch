import { listScenarios as apiListScenarios } from "../langwatch-api.js";

/**
 * Handles the list_scenarios MCP tool invocation.
 *
 * Lists all scenarios in the LangWatch project, formatted as an
 * AI-readable digest or raw JSON.
 */
export async function handleListScenarios(params: {
  format?: "digest" | "json";
}): Promise<string> {
  const scenarios = await apiListScenarios();

  if (params.format === "json") {
    return JSON.stringify(scenarios, null, 2);
  }

  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    return "No scenarios found in this project.\n\n> Tip: Use `create_scenario` to create your first scenario.";
  }

  const lines: string[] = [];
  lines.push(`# Scenarios (${scenarios.length} total)\n`);

  for (const s of scenarios) {
    lines.push(`## ${s.name}`);
    lines.push(`**ID**: ${s.id}`);
    const preview =
      s.situation && s.situation.length > 60
        ? s.situation.slice(0, 60) + "..."
        : s.situation;
    lines.push(`**Situation**: ${preview}`);
    lines.push(
      `**Criteria**: ${Array.isArray(s.criteria) ? s.criteria.length : 0} criteria`,
    );
    if (Array.isArray(s.labels) && s.labels.length > 0) {
      lines.push(`**Labels**: ${s.labels.join(", ")}`);
    }
    lines.push("");
  }

  lines.push(
    "> Use `get_scenario` with the ID to see full scenario details.",
  );

  return lines.join("\n");
}
