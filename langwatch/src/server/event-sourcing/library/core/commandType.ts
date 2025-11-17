/**
 * Strongly-typed command type identifiers.
 *
 * Command types represent the type of command being executed (e.g., "trace.rebuild_projection").
 * These are used for routing and processing commands in the event sourcing system.
 */
export type CommandType =
  | "trace.rebuild_projection"
  | "trace.force_rebuild"
  | "trace.bulk_rebuild"
  | "trace.record_span_ingestion";
