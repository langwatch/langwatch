import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

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

  events: {
    timestamp: string;
    name: string;
    attributes: Record<string, string>;
  }[];

  links: {
    traceId: string;
    spanId: string;
    traceState: string;
    attributes: Record<string, string>;
  }[];

  langWatchTenantId: string;
}

export interface SpanIngestionWriteJob {
  tenantId: string;
  spanData: ReadableSpan;
  collectedAtUnixMs: number;
}

export interface SpanIngestionWriteRecord {
  readableSpan: ReadableSpan;
  tenantId: string;
}
