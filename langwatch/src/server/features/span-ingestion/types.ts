import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { Span } from "../../tracer/types";

export interface IngestedSpan {
  id: string;

  timestamp: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  traceState: string | null;

  spanName: string;
  spanKind: string;
  serviceName: string;

  resourceAttributes: Record<string, string>;
  spanAttributes: Record<string, string>;
  scopeName: string;
  scopeVersion: string;

  duration: number;

  statusCode: string;
  statusMessage: string | null;

  eventsTimestamp: string[];
  eventsName: string[];
  eventsAttributes: Record<string, string>[];

  linksTraceId: string[];
  linksSpanId: string[];
  linksTraceState: string[];
  linksAttributes: Record<string, string>[];

  langWatchTenantId: string;
}

export interface ClickHouseSpanPayload {
  tenantId: string;
  traceId: string;
  span: IngestedSpan;
}

export interface SpanIngestionWriteJob {
  tenantId: string;
  traceId: string;
  spanId: string;
  spanData: IngestedSpan;
  collectedAt: number;
}

export interface SpanIngestionWriteRecord {
  readableSpan: ReadableSpan;
  originalSpan: Span;
  tenantId: string;
  traceState: string | null;
}
