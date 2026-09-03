import { rerunRunPlan as apiRerunRunPlan, type RunParameters } from "../langwatch-api-run-plans.js";
import { formatRunPlanRun } from "./format-run-plan.js";

/**
 * Handles the platform_rerun_run_plan MCP tool invocation.
 */
export async function handleRerunRunPlan(params: {
  id: string;
  parameters?: RunParameters;
  note?: string;
}): Promise<string> {
  const result = await apiRerunRunPlan(params.id, {
    parameters: params.parameters,
    note: params.note,
  });

  return formatRunPlanRun(result);
}
