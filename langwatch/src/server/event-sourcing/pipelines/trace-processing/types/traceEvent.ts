import type { Event, EventMetadataBase } from "../../../library";
import type { SpanIngestionEventData } from "../../span-processing/types";

/**
 * Base metadata for all trace events.
 * Extends EventMetadataBase to include processingTraceparent.
 */
export interface TraceEventMetadata extends EventMetadataBase {
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
 * Event representing a span that was ingested.
 */
export interface TraceSpanIngestedEvent
  extends Event<string, SpanIngestionEventData, TraceEventMetadata> {
  aggregateId: string;
  type: "lw.obs.span.ingestion.recorded";
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
  type: "lw.obs.trace.projection.reset";
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
  type: "lw.obs.trace.projection.recomputed";
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
  return event.type === "lw.obs.span.ingestion.recorded";
}

/**
 * Type guard for TraceProjectionResetEvent.
 */
export function isTraceProjectionResetEvent(
  event: TraceEvent,
): event is TraceProjectionResetEvent {
  return event.type === "lw.obs.trace.projection.reset";
}

/**
 * Type guard for TraceRecomputedEvent.
 */
export function isTraceRecomputedEvent(
  event: TraceEvent,
): event is TraceRecomputedEvent {
  return event.type === "lw.obs.trace.projection.recomputed";
}
