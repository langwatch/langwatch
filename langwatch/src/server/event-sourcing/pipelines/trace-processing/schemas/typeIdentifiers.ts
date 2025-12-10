/**
 * Type identifiers for trace processing events and commands.
 * These are extracted to a separate file to avoid circular dependencies.
 */

export const SPAN_RECEIVED_EVENT_TYPE = "lw.obs.trace.span_received" as const;

export const TRACE_PROCESSING_EVENT_TYPES = [SPAN_RECEIVED_EVENT_TYPE] as const;

export type TraceProcessingEventType =
  (typeof TRACE_PROCESSING_EVENT_TYPES)[number];

export const RECORD_SPAN_COMMAND_TYPE = "lw.obs.trace.record_span" as const;

export const TRACE_PROCESSING_COMMAND_TYPES = [
  RECORD_SPAN_COMMAND_TYPE,
] as const;

export type TraceProcessingCommandType =
  (typeof TRACE_PROCESSING_COMMAND_TYPES)[number];
