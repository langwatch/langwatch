import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

export interface SpanIngestionWriteRecord {
  readableSpan: ReadableSpan;
  tenantId: string;
}