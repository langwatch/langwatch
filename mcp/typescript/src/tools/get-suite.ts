import { getSuite as apiGetSuite } from "../langwatch-api-suites.js";

/**
 * Handles the platform_get_suite MCP tool invocation.
 */
export async function handleGetSuite(params: {
  id: string;
  format?: "digest" | "json";
}): Promise<string> {
  const suite = await apiGetSuite(params.id);

  if (params.format === "json") {
    return JSON.stringify(suite, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Suite: ${suite.name}\n`);
  lines.push(`**ID**: ${suite.id}`);
  lines.push(`**Slug**: ${suite.slug}`);
  lines.push(`**Description**: ${suite.description ?? "—"}`);
  lines.push(`**Repeat Count**: ${suite.repeatCount}`);
  lines.push(`**Created**: ${suite.createdAt}`);
  lines.push(`**Updated**: ${suite.updatedAt}`);

  if (suite.labels.length > 0) {
    lines.push(`**Labels**: ${suite.labels.join(", ")}`);
  }

  lines.push("\n## Scenarios");
  for (const id of suite.scenarioIds) {
    lines.push(`- ${id}`);
  }

  lines.push("\n## Targets");
  for (const t of suite.targets) {
    lines.push(`- ${t.type}:${t.referenceId}`);
  }

  const totalJobs = suite.scenarioIds.length * suite.targets.length * suite.repeatCount;
  lines.push(`\n**Total jobs per run**: ${totalJobs}`);

  lines.push(
    "\n> Use `platform_run_suite` to trigger a run, or `platform_update_suite` to modify."
  );

  return lines.join("\n");
}
