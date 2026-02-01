export const SPAN_RECEIVED_EVENT_TYPE = "lw.obs.trace.span_received" as const;
export const SPAN_RECEIVED_EVENT_VERSION_LATEST = "2025-12-14" as const;

export const SPAN_RECEIVED_EVENT_VERSIONS = [
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
] as const;

export const TOPIC_ASSIGNED_EVENT_TYPE = "lw.obs.trace.topic_assigned" as const;
export const TOPIC_ASSIGNED_EVENT_VERSION_LATEST = "2025-02-01" as const;

export const TOPIC_ASSIGNED_EVENT_VERSIONS = [
  TOPIC_ASSIGNED_EVENT_VERSION_LATEST,
] as const;

export const TRACE_PROCESSING_EVENT_TYPES = [
  SPAN_RECEIVED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_TYPE,
] as const;

export type TraceProcessingEventType =
  (typeof TRACE_PROCESSING_EVENT_TYPES)[number];

export const RECORD_SPAN_COMMAND_TYPE = "lw.obs.trace.record_span" as const;

export const TRACE_PROCESSING_COMMAND_TYPES = [
  RECORD_SPAN_COMMAND_TYPE,
] as const;

export type TraceProcessingCommandType =
  (typeof TRACE_PROCESSING_COMMAND_TYPES)[number];

export const TRACE_SUMMARY_PROJECTION_VERSION_LATEST = "2025-12-16" as const;

export const TRACE_SUMMARY_PROJECTION_VERSIONS = [
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
] as const;
