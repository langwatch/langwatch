/**
 * Strongly-typed event type identifiers.
 *
 * Event types represent the type of event that occurred (e.g., "span.ingestion.ingested").
 * These are used for routing and processing events in the event sourcing system.
 */
export type EventType =
  | "span.ingestion.ingested"
  | "trace.projection.reset"
  | "trace.projection.recomputed";
