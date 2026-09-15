/**
 * ID generators for scenario execution.
 *
 * Kept in their own module so callers can mint IDs without importing the queue.
 */

import { generate } from "@langwatch/ksuid";

/** Generates a unique batch run ID for grouping scenario executions */
export function generateBatchRunId(): string {
  return generate("scenariobatch").toString();
}

/** Generates a unique scenario run ID with `scenariorun_` prefix for SDK passthrough */
export function generateScenarioRunId(): string {
  return generate("scenariorun").toString();
}
