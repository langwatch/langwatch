/**
 * ID generators for scenario execution.
 *
 * Extracted from scenario.queue.ts so they're available without BullMQ.
 */

import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

/** Generates a unique batch run ID for grouping scenario executions */
export function generateBatchRunId(): string {
  return generate(KSUID_RESOURCES.SCENARIO_BATCH).toString();
}

/** Generates a unique scenario run ID with `scenariorun_` prefix for SDK passthrough */
export function generateScenarioRunId(): string {
  return generate(KSUID_RESOURCES.SCENARIO_RUN).toString();
}
