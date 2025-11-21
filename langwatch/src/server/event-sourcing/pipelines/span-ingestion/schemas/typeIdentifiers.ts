/**
 * Type identifiers for span ingestion events and commands.
 * These are extracted to a separate file to avoid circular dependencies.
 */

export const SPAN_INGESTION_RECORDED_EVENT_TYPE = "lw.obs.span_ingestion.recorded" as const;

export const SPAN_INGESTION_EVENT_TYPES = [
  SPAN_INGESTION_RECORDED_EVENT_TYPE,
] as const;

export type SpanIngestionEventType = (typeof SPAN_INGESTION_EVENT_TYPES)[number];

export const SPAN_INGESTION_RECORD_COMMAND_TYPE = "lw.obs.span_ingestion.record" as const;

export const SPAN_INGESTION_COMMAND_TYPES = [
  SPAN_INGESTION_RECORD_COMMAND_TYPE,
] as const;

export type SpanIngestionCommandType = (typeof SPAN_INGESTION_COMMAND_TYPES)[number];

