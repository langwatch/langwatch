import type { Attributes, SpanKind } from "@opentelemetry/api";

/**
 * JSON-serializable DTO for span ingestion write job data.
 * This replaces the non-serializable ReadableSpan in job payloads.
 */
export interface SpanIngestionWriteJobData {
  // Span context fields
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState: string | null;
  isRemote: boolean;

  // Parent span context
  parentSpanId: string | null;

  // Basic span info
  name: string;
  kind: SpanKind;
  startTimeUnixMs: number;
  endTimeUnixMs: number;

  // Attributes
  attributes: Attributes;

  // Events
  events: Array<{
    name: string;
    timeUnixMs: number;
    attributes: Attributes;
  }>;

  // Links
  links: Array<{
    traceId: string;
    spanId: string;
    traceState: string | null;
    attributes: Attributes | undefined;
  }>;

  // Status
  status: {
    code: number;
    message: string | null;
  };

  // Resource data
  resourceAttributes: Attributes | undefined;

  // Instrumentation scope
  instrumentationScope: {
    name: string;
    version: string | null;
  };

  // Additional metadata
  durationMs: number;
  ended: boolean;
  droppedAttributesCount: number;
  droppedEventsCount: number;
  droppedLinksCount: number;
}
