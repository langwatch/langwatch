/**
 * Type identifiers for all events and commands.
 * This file is separate from the main schemas/index.ts to avoid circular dependencies.
 * Domain files can import type identifiers from here without triggering schema evaluation.
 */

import {
  EVALUATION_PROCESSING_COMMAND_TYPES,
  EVALUATION_PROCESSING_EVENT_TYPES,
} from "../pipelines/evaluation-processing/schemas/constants";
import {
  EXPERIMENT_RUN_PROCESSING_COMMAND_TYPES,
  EXPERIMENT_RUN_PROCESSING_EVENT_TYPES,
} from "../pipelines/experiment-run-processing/schemas/constants";
import {
  SIMULATION_RUN_PROCESSING_COMMAND_TYPES,
  SIMULATION_PROCESSING_EVENT_TYPES,
} from "../pipelines/simulation-processing/schemas/constants";
import {
  TRACE_PROCESSING_COMMAND_TYPES,
  TRACE_PROCESSING_EVENT_TYPES,
} from "../pipelines/trace-processing/schemas/constants";

/**
 * Test event type identifiers for integration tests.
 * These are minimal identifiers without full schemas - used only for validation.
 */
const TEST_EVENT_TYPES = ["test.integration.event"] as const;

/**
 * All event type identifiers defined in schemas.
 */
export const EVENT_TYPE_IDENTIFIERS = [
  ...TRACE_PROCESSING_EVENT_TYPES,
  ...EVALUATION_PROCESSING_EVENT_TYPES,
  ...EXPERIMENT_RUN_PROCESSING_EVENT_TYPES,
  ...SIMULATION_PROCESSING_EVENT_TYPES,
  ...TEST_EVENT_TYPES,
] as const;

/**
 * All command type identifiers defined in schemas.
 */
export const COMMAND_TYPE_IDENTIFIERS = [
  ...TRACE_PROCESSING_COMMAND_TYPES,
  ...EVALUATION_PROCESSING_COMMAND_TYPES,
  ...EXPERIMENT_RUN_PROCESSING_COMMAND_TYPES,
  ...SIMULATION_RUN_PROCESSING_COMMAND_TYPES,
] as const;

/**
 * Test aggregate type identifier for integration tests.
 * Used only for validation - no full schema required.
 */
const TEST_AGGREGATE_TYPE = "test_aggregate" as const;

/**
 * Aggregate type identifiers extracted from event/command identifiers.
 * Note: "span" aggregate was removed as span storage is now handled
 * via event handler in the trace-processing pipeline.
 */
export const AGGREGATE_TYPE_IDENTIFIERS = [
  "trace",
  "evaluation",
  "experiment_run",
  "simulation_run",
  "global",
  TEST_AGGREGATE_TYPE,
] as const;
