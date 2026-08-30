import type {
  RunPlanRunResult,
  RunPlanScope,
} from "../langwatch-api-run-plans.js";

/**
 * The digest every run of a plan returns, whichever tool started it.
 *
 * It says which plan ran and whether the run created it or joined one that
 * already carried the name, because that is the difference between a new plan
 * and a plan whose configuration this run just replaced.
 */
export function formatRunPlanRun(result: RunPlanRunResult): string {
  const lines: string[] = [];

  lines.push(
    result.created
      ? `Run plan "${result.planName}" created and started.`
      : `Run plan "${result.planName}" started with the configuration of this run.`,
  );
  lines.push("");
  lines.push(`**Plan**: ${result.planName} (${result.runPlanId})`);
  lines.push(`**Batch Run ID**: ${result.batchRunId}`);
  lines.push(`**Set ID**: ${result.setId}`);
  lines.push(`**Jobs**: ${result.jobCount}`);

  if (result.skippedArchived.scenarios.length > 0) {
    lines.push(
      `**Skipped archived scenarios**: ${result.skippedArchived.scenarios.join(", ")}`,
    );
  }
  if (result.skippedArchived.targets.length > 0) {
    lines.push(
      `**Skipped archived targets**: ${result.skippedArchived.targets.join(", ")}`,
    );
  }

  lines.push(`**View**: ${result.platformUrl}`);
  lines.push("");
  lines.push(
    "> Use `platform_list_simulation_runs` with the batch run ID to read the results.",
  );

  return lines.join("\n");
}

/**
 * One line saying what a plan covers. A plan stored before scopes existed
 * carries none, and runs the scenario list it already held.
 */
export function describeRunPlanScope(
  scope: RunPlanScope | null,
  scenarioIds: string[],
): string {
  if (scope === null) {
    return `hand-picked scenarios (${scenarioIds.length})`;
  }
  switch (scope.mode) {
    case "all":
      return "every scenario in the project";
    case "test_suites":
      return `test suites: ${scope.testSuiteIds.join(", ")}`;
    case "labels":
      return `labels: ${scope.labels.join(", ")}`;
    case "scenarios":
      return `hand-picked scenarios (${scenarioIds.length})`;
  }
}
