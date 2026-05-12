import { listSuites as apiListSuites } from "../langwatch-api-suites.js";

/**
 * Handles the platform_list_suites MCP tool invocation.
 */
export async function handleListSuites(params: {
  format?: "digest" | "json";
}): Promise<string> {
  const suites = await apiListSuites();

  if (params.format === "json") {
    return JSON.stringify(suites, null, 2);
  }

  if (!Array.isArray(suites) || suites.length === 0) {
    return "No suites (run plans) found in this project.\n\n> Tip: Use `platform_create_suite` to create your first suite.";
  }

  const lines: string[] = [];
  lines.push(`# Suites / Run Plans (${suites.length} total)\n`);

  for (const s of suites) {
    lines.push(`## ${s.name}`);
    lines.push(`**ID**: ${s.id}`);
    lines.push(`**Slug**: ${s.slug}`);
    lines.push(`**Scenarios**: ${s.scenarioIds.length}`);
    lines.push(`**Targets**: ${s.targets.length} (${s.targets.map((t) => `${t.type}:${t.referenceId}`).join(", ")})`);
    lines.push(`**Repeat**: ${s.repeatCount}x`);
    if (s.description) {
      lines.push(`**Description**: ${s.description}`);
    }
    if (Array.isArray(s.labels) && s.labels.length > 0) {
      lines.push(`**Labels**: ${s.labels.join(", ")}`);
    }
    lines.push("");
  }

  lines.push(
    "> Use `platform_get_suite` with the ID to see full details, or `platform_run_suite` to trigger execution."
  );

  return lines.join("\n");
}
