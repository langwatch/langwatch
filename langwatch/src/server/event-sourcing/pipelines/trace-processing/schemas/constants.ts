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

export const LOG_RECORD_RECEIVED_EVENT_TYPE =
  "lw.obs.trace.log_record_received" as const;
export const LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST = "2026-03-08" as const;

export const LOG_RECORD_RECEIVED_EVENT_VERSIONS = [
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
] as const;

export const METRIC_RECORD_RECEIVED_EVENT_TYPE =
  "lw.obs.trace.metric_record_received" as const;
export const METRIC_RECORD_RECEIVED_EVENT_VERSION_LATEST = "2026-03-08" as const;

export const METRIC_RECORD_RECEIVED_EVENT_VERSIONS = [
  METRIC_RECORD_RECEIVED_EVENT_VERSION_LATEST,
] as const;

export const ORIGIN_RESOLVED_EVENT_TYPE =
  "lw.obs.trace.origin_resolved" as const;
export const ORIGIN_RESOLVED_EVENT_VERSION_LATEST = "2026-03-13" as const;

export const ORIGIN_RESOLVED_EVENT_VERSIONS = [
  ORIGIN_RESOLVED_EVENT_VERSION_LATEST,
] as const;

export const ANNOTATION_ADDED_EVENT_TYPE =
  "lw.obs.trace.annotation_added" as const;
export const ANNOTATION_ADDED_EVENT_VERSION_LATEST = "2026-03-25" as const;

export const ANNOTATION_ADDED_EVENT_VERSIONS = [
  ANNOTATION_ADDED_EVENT_VERSION_LATEST,
] as const;

export const ANNOTATION_REMOVED_EVENT_TYPE =
  "lw.obs.trace.annotation_removed" as const;
export const ANNOTATION_REMOVED_EVENT_VERSION_LATEST = "2026-03-25" as const;

export const ANNOTATION_REMOVED_EVENT_VERSIONS = [
  ANNOTATION_REMOVED_EVENT_VERSION_LATEST,
] as const;

export const ANNOTATIONS_BULK_SYNCED_EVENT_TYPE =
  "lw.obs.trace.annotations_bulk_synced" as const;
export const ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST = "2026-03-25" as const;

export const ANNOTATIONS_BULK_SYNCED_EVENT_VERSIONS = [
  ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
] as const;

export const TRACE_ARCHIVED_EVENT_TYPE =
  "lw.obs.trace.trace_archived" as const;
export const TRACE_ARCHIVED_EVENT_VERSION_LATEST = "2026-04-16" as const;

export const TRACE_ARCHIVED_EVENT_VERSIONS = [
  TRACE_ARCHIVED_EVENT_VERSION_LATEST,
] as const;

export const TRACE_PROCESSING_EVENT_TYPES = [
  SPAN_RECEIVED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  METRIC_RECORD_RECEIVED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_TYPE,
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_REMOVED_EVENT_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  TRACE_ARCHIVED_EVENT_TYPE,
] as const;

export type TraceProcessingEventType =
  (typeof TRACE_PROCESSING_EVENT_TYPES)[number];

export const RECORD_SPAN_COMMAND_TYPE = "lw.obs.trace.record_span" as const;
export const ASSIGN_TOPIC_COMMAND_TYPE = "lw.obs.trace.assign_topic" as const;
export const RECORD_LOG_COMMAND_TYPE = "lw.obs.trace.record_log" as const;
export const RECORD_METRIC_COMMAND_TYPE = "lw.obs.trace.record_metric" as const;
export const RESOLVE_ORIGIN_COMMAND_TYPE = "lw.obs.trace.resolve_origin" as const;
export const ADD_ANNOTATION_COMMAND_TYPE = "lw.obs.trace.add_annotation" as const;
export const REMOVE_ANNOTATION_COMMAND_TYPE = "lw.obs.trace.remove_annotation" as const;
export const BULK_SYNC_ANNOTATIONS_COMMAND_TYPE = "lw.obs.trace.bulk_sync_annotations" as const;

export const ARCHIVE_TRACE_COMMAND_TYPE = "lw.obs.trace.archive_trace" as const;

export const TRACE_PROCESSING_COMMAND_TYPES = [
  RECORD_SPAN_COMMAND_TYPE,
  ASSIGN_TOPIC_COMMAND_TYPE,
  RECORD_LOG_COMMAND_TYPE,
  RECORD_METRIC_COMMAND_TYPE,
  RESOLVE_ORIGIN_COMMAND_TYPE,
  ADD_ANNOTATION_COMMAND_TYPE,
  REMOVE_ANNOTATION_COMMAND_TYPE,
  BULK_SYNC_ANNOTATIONS_COMMAND_TYPE,
  ARCHIVE_TRACE_COMMAND_TYPE,
] as const;

export type TraceProcessingCommandType =
  (typeof TRACE_PROCESSING_COMMAND_TYPES)[number];

export const TRACE_SUMMARY_PROJECTION_VERSION_LATEST = "2026-03-25" as const;

/** Reactors skip traces older than this threshold to avoid re-processing during resyncs. */
export const STALE_TRACE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export const TRACE_SUMMARY_PROJECTION_VERSIONS = [
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
] as const;
