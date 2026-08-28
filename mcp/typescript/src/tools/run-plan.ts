import {
  runRunPlan as apiRunRunPlan,
  type RunParameters,
  type RunPlanScope,
  type RunPlanTarget,
} from "../langwatch-api-run-plans.js";
import { formatRunPlanRun } from "./format-run-plan.js";

/**
 * Handles the platform_run_plan MCP tool invocation.
 */
export async function handleRunPlan(params: {
  name?: string;
  scope: RunPlanScope;
  scenarioIds?: string[];
  targets: RunPlanTarget[];
  repeatCount?: number;
  simulatorModel?: string;
  judgeModel?: string;
  parameters?: RunParameters;
  note?: string;
  idempotencyKey?: string;
}): Promise<string> {
  const result = await apiRunRunPlan({
    name: params.name,
    config: {
      scope: params.scope,
      targets: params.targets,
      repeatCount: params.repeatCount,
      simulatorModel: params.simulatorModel,
      judgeModel: params.judgeModel,
      scenarioIds: params.scenarioIds,
    },
    idempotencyKey: params.idempotencyKey,
    parameters: params.parameters,
    note: params.note,
  });

  return formatRunPlanRun(result);
}
