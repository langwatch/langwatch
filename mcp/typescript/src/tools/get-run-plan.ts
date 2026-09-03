import { getRunPlan as apiGetRunPlan } from "../langwatch-api-run-plans.js";
import { describeRunPlanScope } from "./format-run-plan.js";

/**
 * Handles the platform_get_run_plan MCP tool invocation.
 */
export async function handleGetRunPlan(params: {
  id: string;
  format?: "digest" | "json";
}): Promise<string> {
  const plan = await apiGetRunPlan(params.id);

  if (params.format === "json") {
    return JSON.stringify(plan, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Run Plan: ${plan.name}\n`);
  lines.push(`**ID**: ${plan.id}`);
  lines.push(`**Slug**: ${plan.slug}`);
  lines.push(`**Covers**: ${describeRunPlanScope(plan.scope, plan.scenarioIds)}`);
  lines.push(`**Repeat**: ${plan.repeatCount}x`);
  lines.push(`**Simulator model**: ${plan.simulatorModel ?? "project default"}`);
  lines.push(`**Judge model**: ${plan.judgeModel ?? "project default"}`);
  if (plan.labels.length > 0) {
    lines.push(`**Labels**: ${plan.labels.join(", ")}`);
  }
  if (plan.archivedAt) {
    lines.push(`**Archived**: ${plan.archivedAt}`);
  }
  lines.push(`**Created**: ${plan.createdAt}`);
  lines.push(`**Updated**: ${plan.updatedAt}`);

  lines.push("\n## Targets");
  for (const target of plan.targets) {
    // The parameters are part of the target's identity, so a plan that
    // compares one agent on two models reads as two lines that differ.
    const overrides = Object.entries(target.runParameters ?? {})
      .map(([name, value]) => `${name}=${String(value)}`)
      .join(", ");
    lines.push(`- ${target.type}:${target.referenceId}${overrides ? ` (${overrides})` : ""}`);
  }

  if (plan.scenarioIds.length > 0) {
    lines.push("\n## Scenarios");
    for (const id of plan.scenarioIds) {
      lines.push(`- ${id}`);
    }
  }

  lines.push(`\n**View**: ${plan.platformUrl}`);
  lines.push(
    "\n> Use `platform_rerun_run_plan` to run this configuration again, or `platform_run_plan` with this name to replace it.",
  );

  return lines.join("\n");
}
