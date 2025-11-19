/**
 * Span ingestion event types.
 * Types are inferred from Zod schemas for validation and type safety.
 */
export type {
  SpanIngestionEventMetadata,
  SpanIngestionEventData,
  SpanIngestionRecordedEventMetadata,
  SpanIngestionRecordedEvent,
  SpanIngestionEvent,
} from "../../schemas/events/spanIngestion.schema";

import type {
  SpanIngestionEvent,
  SpanIngestionRecordedEvent,
} from "../../schemas/events/spanIngestion.schema";

/**
 * Type guard for SpanIngestionRecordedEvent.
 */
export function isSpanIngestionRecordedEvent(
  event: SpanIngestionEvent,
): event is SpanIngestionRecordedEvent {
  return event.type === "lw.obs.span_ingestion.recorded";
}
