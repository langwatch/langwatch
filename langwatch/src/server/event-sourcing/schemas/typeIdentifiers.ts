/**
 * Type identifiers for all events and commands.
 * This file is separate from the main schemas/index.ts to avoid circular dependencies.
 * Domain files can import type identifiers from here without triggering schema evaluation.
 */

import {
  SPAN_INGESTION_COMMAND_TYPES,
  SPAN_INGESTION_EVENT_TYPES,
} from "../pipelines/span-ingestion/schemas/typeIdentifiers";
import {
  TRACE_AGGREGATION_COMMAND_TYPES,
  TRACE_AGGREGATION_EVENT_TYPES,
} from "../pipelines/trace-aggregation/schemas/typeIdentifiers";

/**
 * Test event type identifiers for integration tests.
 * These are minimal identifiers without full schemas - used only for validation.
 */
const TEST_EVENT_TYPES = ["test.integration.event"] as const;

/**
 * All event type identifiers defined in schemas.
 */
export const EVENT_TYPE_IDENTIFIERS = [
  ...SPAN_INGESTION_EVENT_TYPES,
  ...TRACE_AGGREGATION_EVENT_TYPES,
  ...TEST_EVENT_TYPES,
] as const;

/**
 * All command type identifiers defined in schemas.
 */
export const COMMAND_TYPE_IDENTIFIERS = [
  ...SPAN_INGESTION_COMMAND_TYPES,
  ...TRACE_AGGREGATION_COMMAND_TYPES,
] as const;

/**
 * Test aggregate type identifier for integration tests.
 * Used only for validation - no full schema required.
 */
const TEST_AGGREGATE_TYPE = "test_aggregate" as const;

/**
 * Aggregate type identifiers extracted from event/command identifiers.
 * Aggregate types are the third segment in the identifier (e.g., "span_ingestion" from "lw.obs.span_ingestion.recorded").
 */
export const AGGREGATE_TYPE_IDENTIFIERS = [
  "span_ingestion",
  "trace_aggregation",
  TEST_AGGREGATE_TYPE,
] as const;
