import type { Event, EventMetadataBase } from "../../../library";

/**
 * Base metadata for all span events.
 * Extends EventMetadataBase to include processingTraceparent.
 */
export interface SpanEventMetadata extends EventMetadataBase {
  collectedAtUnixMs?: number;
  spanId?: string;
  commandId?: string;
}

/**
 * Union of all span event types.
 */
export type SpanEvent = SpanIngestionEvent;

/**
 * Slim payload for a span ingestion event.
 * Full span content lives in observability_spans; this payload is a signal.
 */
export interface SpanIngestionEventData {
  traceId: string;
  spanId: string;
  collectedAtUnixMs: number;
}

/**
 * Event representing a span that was ingested.
 * Aggregate ID is composite: traceId/spanId
 */
export interface SpanIngestionEvent
  extends Event<string, SpanIngestionEventData, SpanEventMetadata> {
  aggregateId: string; // Format: traceId/spanId
  type: "lw.obs.span.ingestion.recorded";
  metadata: SpanIngestionEventMetadata;
}

export interface SpanIngestionEventMetadata extends SpanEventMetadata {
  spanId: string;
  collectedAtUnixMs: number;
}

/**
 * Type guard for SpanIngestionEvent.
 */
export function isSpanIngestionEvent(
  event: SpanEvent,
): event is SpanIngestionEvent {
  return event.type === "lw.obs.span.ingestion.recorded";
}
