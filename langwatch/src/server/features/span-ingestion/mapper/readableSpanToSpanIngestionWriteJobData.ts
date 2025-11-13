import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { SpanIngestionWriteJobData } from "../types/spanIngestionWriteJobData";

/**
 * Converts a ReadableSpan to a JSON-serializable DTO for job queuing.
 * This mapping is critical for Queue serialization.
 */
export function mapReadableSpanToSpanIngestionWriteJobData(
  span: ReadableSpan,
): SpanIngestionWriteJobData {
  const spanContext = span.spanContext();
  const parentSpanContext = span.parentSpanContext;

  // Convert HrTime [seconds, nanoseconds] to milliseconds
  const startTimeUnixMs = span.startTime[0] * 1000 + span.startTime[1] / 1_000_000;
  const endTimeUnixMs = span.endTime[0] * 1000 + span.endTime[1] / 1_000_000;
  const durationMs = endTimeUnixMs - startTimeUnixMs;

  return {
    // Span context fields
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
    traceState: spanContext.traceState?.serialize() ?? null,
    isRemote: spanContext.isRemote ?? false,

    // Parent span context
    parentSpanId: parentSpanContext?.spanId ?? null,

    // Basic span info
    name: span.name,
    kind: span.kind,
    startTimeUnixMs,
    endTimeUnixMs,

    // Attributes (already a plain object/record)
    attributes: span.attributes,

    // Events - convert TimedEvent[] to serializable format
    events: span.events.map(event => ({
      name: event.name,
      timeUnixMs: event.time[0] * 1000 + event.time[1] / 1_000_000,
      attributes: event.attributes ?? {},
    })),

    // Links - convert Link[] to serializable format
    links: span.links.map(link => ({
      traceId: link.context.traceId,
      spanId: link.context.spanId,
      traceState: link.context.traceState?.serialize() ?? null,
      attributes: link.attributes ?? {},
    })),

    // Status
    status: {
      code: span.status.code,
      message: span.status.message ?? null,
    },

    // Resource data - get raw attributes
    resourceAttributes: span.resource.attributes,

    // Instrumentation scope
    instrumentationScope: {
      name: span.instrumentationScope.name,
      version: span.instrumentationScope.version ?? null,
    },

    // Additional metadata
    durationMs,
    ended: span.ended,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}
