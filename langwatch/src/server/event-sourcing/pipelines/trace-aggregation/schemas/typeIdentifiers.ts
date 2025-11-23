/**
 * Type identifiers for trace aggregation events and commands.
 * These are extracted to a separate file to avoid circular dependencies.
 */

export const TRACE_AGGREGATION_COMPLETED_EVENT_TYPE = "lw.obs.trace_aggregation.completed" as const;

export const TRACE_AGGREGATION_EVENT_TYPES = [
  TRACE_AGGREGATION_COMPLETED_EVENT_TYPE,
] as const;

export type TraceAggregationEventType = (typeof TRACE_AGGREGATION_EVENT_TYPES)[number];

export const TRACE_AGGREGATION_TRIGGER_COMMAND_TYPE = "lw.obs.trace_aggregation.trigger" as const;

export const TRACE_AGGREGATION_COMMAND_TYPES = [
  TRACE_AGGREGATION_TRIGGER_COMMAND_TYPE,
] as const;

export type TraceAggregationCommandType = (typeof TRACE_AGGREGATION_COMMAND_TYPES)[number];

