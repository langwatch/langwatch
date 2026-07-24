import { runSuite as apiRunSuite } from "../langwatch-api-suites.js";

/**
 * Handles the platform_run_suite MCP tool invocation.
 */
export async function handleRunSuite(params: {
  id: string;
}): Promise<string> {
  const result = await apiRunSuite(params.id);

  const lines: string[] = [];
  lines.push(`Suite run scheduled successfully.`);
  lines.push("");
  lines.push(`**Batch Run ID**: ${result.batchRunId}`);
  lines.push(`**Jobs**: ${result.jobCount}`);
  lines.push(`**Set ID**: ${result.setId}`);

  if (result.skippedArchived.scenarios.length > 0) {
    lines.push(`\n⚠️ Skipped archived scenarios: ${result.skippedArchived.scenarios.join(", ")}`);
  }
  if (result.skippedArchived.targets.length > 0) {
    lines.push(`⚠️ Skipped archived targets: ${result.skippedArchived.targets.join(", ")}`);
  }

  lines.push("\nView results in the LangWatch dashboard under Simulations.");

  return lines.join("\n");
}
