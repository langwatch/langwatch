/**
 * Event and command type constants for the activity-monitor-processing
 * pipeline. Receives normalised OCSF + AOS events from the
 * IngestionSource receivers (Tier C/D platforms).
 */

export const ACTIVITY_EVENT_TYPES = {
  RECEIVED: "lw.activity_event.received",
} as const;

export const ACTIVITY_EVENT_VERSIONS = {
  RECEIVED: "2026-04-27",
} as const;

export const ACTIVITY_COMMAND_TYPES = {
  RECORD: "lw.activity_event.record",
} as const;

/**
 * Tuples consumed by `schemas/typeIdentifiers.ts` to extend the
 * closed taxonomy of event + command type identifiers.
 */
export const ACTIVITY_MONITOR_PROCESSING_EVENT_TYPES = [
  ACTIVITY_EVENT_TYPES.RECEIVED,
] as const;

export const ACTIVITY_MONITOR_PROCESSING_COMMAND_TYPES = [
  ACTIVITY_COMMAND_TYPES.RECORD,
] as const;

export type ActivityMonitorProcessingEventType =
  (typeof ACTIVITY_MONITOR_PROCESSING_EVENT_TYPES)[number];
export type ActivityMonitorProcessingCommandType =
  (typeof ACTIVITY_MONITOR_PROCESSING_COMMAND_TYPES)[number];
