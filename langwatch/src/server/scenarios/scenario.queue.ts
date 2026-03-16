/**
 * Scenario ID generators.
 *
 * BullMQ queue infrastructure has been removed — scenario execution
 * is now handled by the event sourcing pipeline + dedicated GroupQueueProcessor.
 *
 * These ID generators are still needed by callers that pre-assign IDs.
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
