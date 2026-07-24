import { listSimulationRuns as apiListSimulationRuns } from "../langwatch-api-simulation-runs.js";

/**
 * Handles the platform_list_simulation_runs MCP tool invocation.
 */
export async function handleListSimulationRuns(params: {
  scenarioSetId?: string;
  batchRunId?: string;
  limit?: number;
  format?: "digest" | "json";
}): Promise<string> {
  const result = await apiListSimulationRuns({
    scenarioSetId: params.scenarioSetId,
    batchRunId: params.batchRunId,
    limit: params.limit,
  });

  if (params.format === "json") {
    return JSON.stringify(result, null, 2);
  }

  const { runs } = result;

  if (runs.length === 0) {
    return "No simulation runs found.\n\n> Run a suite first with `platform_run_suite` to create simulation runs.";
  }

  const lines: string[] = [];
  lines.push(`# Simulation Runs (${runs.length} results${result.hasMore ? ", more available" : ""})\n`);

  for (const run of runs) {
    const statusIcon = run.status === "SUCCESS" ? "pass" : run.status === "FAILED" ? "FAIL" : run.status;
    const duration = run.durationInMs > 0 ? `${(run.durationInMs / 1000).toFixed(1)}s` : "—";
    const verdict = run.results?.verdict ?? "";

    lines.push(`## ${run.name ?? run.scenarioId} — ${statusIcon}${verdict ? ` (${verdict})` : ""}`);
    lines.push(`**Run ID**: ${run.scenarioRunId}`);
    lines.push(`**Batch**: ${run.batchRunId}`);
    lines.push(`**Duration**: ${duration}`);
    if (run.totalCost) {
      lines.push(`**Cost**: $${run.totalCost.toFixed(4)}`);
    }
    lines.push("");
  }

  lines.push("> Use `platform_get_simulation_run` with a run ID to see full details (messages, results).");

  return lines.join("\n");
}
