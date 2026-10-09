import {
  runRunPlan as apiRunRunPlan,
  type RunParameters,
  type RunPlanScope,
  type RunPlanTarget,
} from "../langwatch-api-run-plans.js";
import { toWireTargets } from "../schemas/run-plan.js";
import {
  type EvaluatorAttachmentInput,
  toWireAttachments,
} from "../schemas/suite-fields.js";
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
  evaluators?: EvaluatorAttachmentInput[];
  parameters?: RunParameters;
  note?: string;
  idempotencyKey?: string;
}): Promise<string> {
  const result = await apiRunRunPlan({
    name: params.name,
    config: {
      scope: params.scope,
      targets: toWireTargets(params.targets),
      repeatCount: params.repeatCount,
      simulatorModel: params.simulatorModel,
      judgeModel: params.judgeModel,
      scenarioIds: params.scenarioIds,
      ...(params.evaluators !== undefined
        ? { evaluators: toWireAttachments(params.evaluators) }
        : {}),
    },
    idempotencyKey: params.idempotencyKey,
    parameters: params.parameters,
    note: params.note,
  });

  return formatRunPlanRun(result);
}
