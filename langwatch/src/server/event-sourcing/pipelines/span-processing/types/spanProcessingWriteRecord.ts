import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

export interface SpanProcessingWriteRecord {
  readableSpan: ReadableSpan;
  tenantId: string;
}
