import { listScenarios as apiListScenarios } from "../langwatch-api-scenarios.js";

/**
 * Handles the platform_list_scenarios MCP tool invocation.
 *
 * Lists all scenarios in the LangWatch project, formatted as an
 * AI-readable digest or raw JSON.
 */
export async function handleListScenarios(params: {
  folderId?: string;
  format?: "digest" | "json";
}): Promise<string> {
  const all = await apiListScenarios();

  // The REST list takes no folder query, so the filter runs here on the
  // folderId every scenario already carries in the response.
  const scenarios =
    params.folderId !== undefined && Array.isArray(all)
      ? all.filter((s) => s.folderId === params.folderId)
      : all;

  if (params.format === "json") {
    return JSON.stringify(scenarios, null, 2);
  }

  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    return params.folderId !== undefined
      ? `No scenarios found in test suite ${params.folderId}.\n\n> Tip: Use \`platform_create_scenario\` with folderId \`${params.folderId}\` to file one there.`
      : "No scenarios found in this project.\n\n> Tip: Use `platform_create_scenario` to create your first scenario.";
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
    "> Use `platform_get_scenario` with the ID to see full scenario details.",
  );

  return lines.join("\n");
}
