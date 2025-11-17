import type { Event, EventMetadataBase } from "../../../library";

/**
 * Base metadata for all trace events.
 * Extends EventMetadataBase to include processingTraceparent.
 */
export interface TraceEventMetadata extends EventMetadataBase {
  tenantId: string;
  collectedAtUnixMs?: number;
  spanId?: string;
  commandId?: string;
}

/**
 * Union of all trace event types.
 */
export type TraceEvent =
  | TraceSpanIngestedEvent
  | TraceProjectionResetEvent
  | TraceRecomputedEvent;

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
 */
export interface TraceSpanIngestedEvent
  extends Event<string, SpanIngestionEventData, TraceEventMetadata> {
  aggregateId: string;
  type: "span.ingestion.ingested";
  metadata: TraceSpanIngestedEventMetadata;
}

export interface TraceSpanIngestedEventMetadata extends TraceEventMetadata {
  spanId: string;
  collectedAtUnixMs: number;
}

/**
 * Event representing a trace projection being reset.
 */
export interface TraceProjectionResetEvent
  extends Event<
    string,
    {
      reason: "manual" | "reprocess" | "anomaly";
      requestedBy?: string;
      note?: string;
    },
    TraceEventMetadata
  > {
  type: "trace.projection.reset";
}

/**
 * Event representing a trace projection being manually recomputed.
 */
export interface TraceRecomputedEvent
  extends Event<
    string,
    {
      triggeredBy?: string;
      reason?: string;
    },
    TraceEventMetadata
  > {
  type: "trace.projection.recomputed";
}

/**
 * Legacy alias for backwards compatibility.
 * SpanEvent now refers to TraceSpanIngestedEvent.
 */
export type SpanEvent = TraceSpanIngestedEvent;

/**
 * Type guard for TraceSpanIngestedEvent.
 */
export function isTraceSpanIngestedEvent(
  event: TraceEvent,
): event is TraceSpanIngestedEvent {
  return event.type === "span.ingestion.ingested";
}

/**
 * Type guard for TraceProjectionResetEvent.
 */
export function isTraceProjectionResetEvent(
  event: TraceEvent,
): event is TraceProjectionResetEvent {
  return event.type === "trace.projection.reset";
}

/**
 * Type guard for TraceRecomputedEvent.
 */
export function isTraceRecomputedEvent(
  event: TraceEvent,
): event is TraceRecomputedEvent {
  return event.type === "trace.projection.recomputed";
}
