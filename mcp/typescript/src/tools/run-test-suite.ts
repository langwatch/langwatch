import type {
  RunParameters,
  RunPlanTarget,
} from "../langwatch-api-run-plans.js";
import { toWireTargets } from "../schemas/run-plan.js";
import { runTestSuite as apiRunTestSuite } from "../langwatch-api-test-suites.js";
import { formatRunPlanRun } from "./format-run-plan.js";

/**
 * Handles the platform_run_test_suite MCP tool invocation.
 */
export async function handleRunTestSuite(params: {
  id: string;
  targets: RunPlanTarget[];
  name?: string;
  repeatCount?: number;
  simulatorModel?: string;
  judgeModel?: string;
  parameters?: RunParameters;
  note?: string;
  idempotencyKey?: string;
}): Promise<string> {
  const { id, targets, ...data } = params;
  const result = await apiRunTestSuite(id, {
    ...data,
    targets: toWireTargets(targets),
  });

  return formatRunPlanRun(result);
}
