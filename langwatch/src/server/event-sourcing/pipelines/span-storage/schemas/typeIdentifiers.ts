/**
 * Type identifiers for span storage events and commands.
 * These are extracted to a separate file to avoid circular dependencies.
 */

export const SPAN_STORED_EVENT_TYPE = "lw.obs.span.span_stored" as const;

export const SPAN_STORAGE_EVENT_TYPES = [SPAN_STORED_EVENT_TYPE] as const;

export type SpanStorageEventType = (typeof SPAN_STORAGE_EVENT_TYPES)[number];

export const STORE_SPAN_COMMAND_TYPE = "lw.obs.span.store_span" as const;

export const SPAN_STORAGE_COMMAND_TYPES = [STORE_SPAN_COMMAND_TYPE] as const;

export type SpanStorageCommandType =
  (typeof SPAN_STORAGE_COMMAND_TYPES)[number];

