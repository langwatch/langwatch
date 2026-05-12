import { getSimulationRun as apiGetSimulationRun } from "../langwatch-api-simulation-runs.js";

/**
 * Handles the platform_get_simulation_run MCP tool invocation.
 */
export async function handleGetSimulationRun(params: {
  scenarioRunId: string;
  format?: "digest" | "json";
}): Promise<string> {
  const run = await apiGetSimulationRun(params.scenarioRunId);

  if (params.format === "json") {
    return JSON.stringify(run, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Simulation Run: ${run.name ?? run.scenarioRunId}\n`);
  lines.push(`**Run ID**: ${run.scenarioRunId}`);
  lines.push(`**Scenario ID**: ${run.scenarioId}`);
  lines.push(`**Batch ID**: ${run.batchRunId}`);
  lines.push(`**Status**: ${run.status}`);

  const duration = run.durationInMs > 0 ? `${(run.durationInMs / 1000).toFixed(1)}s` : "—";
  lines.push(`**Duration**: ${duration}`);
  if (run.totalCost) {
    lines.push(`**Cost**: $${run.totalCost.toFixed(4)}`);
  }
  lines.push(`**Started**: ${new Date(run.timestamp).toISOString()}`);

  if (run.results) {
    lines.push("\n## Results");
    if (run.results.verdict) {
      lines.push(`**Verdict**: ${run.results.verdict}`);
    }
    if (run.results.reasoning) {
      lines.push(`**Reasoning**: ${run.results.reasoning}`);
    }
    if (run.results.metCriteria && run.results.metCriteria.length > 0) {
      lines.push(`**Met Criteria**: ${run.results.metCriteria.join(", ")}`);
    }
    if (run.results.unmetCriteria && run.results.unmetCriteria.length > 0) {
      lines.push(`**Unmet Criteria**: ${run.results.unmetCriteria.join(", ")}`);
    }
    if (run.results.error) {
      lines.push(`**Error**: ${run.results.error}`);
    }
  }

  if (run.messages && run.messages.length > 0) {
    lines.push("\n## Conversation");
    for (const msg of run.messages) {
      const content = msg.content.length > 300
        ? msg.content.slice(0, 300) + "..."
        : msg.content;
      lines.push(`**[${msg.role}]**: ${content}`);
    }
  }

  return lines.join("\n");
}
