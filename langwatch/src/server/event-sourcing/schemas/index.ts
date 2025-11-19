/**
 * LangWatch-specific schemas for the event-sourcing system.
 * These schemas are domain-specific and not part of the generic library.
 */
export * from "./commands/spanIngestion.schema";
export * from "./commands/traceAggregation.schema";
export * from "./events/spanIngestion.schema";
export * from "./events/traceAggregation.schema";

// Collect all type identifiers from schema files
import { SPAN_INGESTION_EVENT_TYPES } from "./events/spanIngestion.schema";
import { TRACE_AGGREGATION_EVENT_TYPES } from "./events/traceAggregation.schema";
import { SPAN_INGESTION_COMMAND_TYPES } from "./commands/spanIngestion.schema";
import { TRACE_AGGREGATION_COMMAND_TYPES } from "./commands/traceAggregation.schema";

/**
 * All event type identifiers defined in schemas.
 */
export const EVENT_TYPE_IDENTIFIERS = [
  ...SPAN_INGESTION_EVENT_TYPES,
  ...TRACE_AGGREGATION_EVENT_TYPES,
] as const;

/**
 * All command type identifiers defined in schemas.
 */
export const COMMAND_TYPE_IDENTIFIERS = [
  ...SPAN_INGESTION_COMMAND_TYPES,
  ...TRACE_AGGREGATION_COMMAND_TYPES,
] as const;

/**
 * Aggregate type identifiers extracted from event/command identifiers.
 * Aggregate types are the third segment in the identifier (e.g., "span_ingestion" from "lw.obs.span_ingestion.recorded").
 */
export const AGGREGATE_TYPE_IDENTIFIERS = [
  "span_ingestion",
  "trace_aggregation",
] as const;
