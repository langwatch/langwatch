import { listRunPlans as apiListRunPlans } from "../langwatch-api-run-plans.js";
import { describeRunPlanScope } from "./format-run-plan.js";

/**
 * Handles the platform_list_run_plans MCP tool invocation.
 */
export async function handleListRunPlans(params: {
  includeArchived?: boolean;
  format?: "digest" | "json";
}): Promise<string> {
  const plans = await apiListRunPlans({
    includeArchived: params.includeArchived,
  });

  if (params.format === "json") {
    return JSON.stringify(plans, null, 2);
  }

  if (!Array.isArray(plans) || plans.length === 0) {
    return "No run plans found in this project.\n\n> Tip: Use `platform_run_plan` to start one. A run plan is created the first time you run its name.";
  }

  const lines: string[] = [];
  lines.push(`# Run Plans (${plans.length} total)\n`);

  for (const plan of plans) {
    lines.push(`## ${plan.name}${plan.archivedAt ? " (archived)" : ""}`);
    lines.push(`**ID**: ${plan.id}`);
    lines.push(`**Covers**: ${describeRunPlanScope(plan.scope, plan.scenarioIds)}`);
    lines.push(
      `**Targets**: ${plan.targets.length} (${plan.targets
        .map((t) => `${t.type}:${t.referenceId}`)
        .join(", ")})`,
    );
    lines.push(`**Repeat**: ${plan.repeatCount}x`);
    if (plan.labels.length > 0) {
      lines.push(`**Labels**: ${plan.labels.join(", ")}`);
    }
    lines.push("");
  }

  lines.push(
    "> Use `platform_get_run_plan` with the ID for the full configuration, or `platform_rerun_run_plan` to run it again.",
  );

  return lines.join("\n");
}
