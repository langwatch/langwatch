import type { SpanInsertData } from "@langwatch/trace-contract";

/** Private persistence capability for canonical stored spans. */
export abstract class TraceSpanStoragePort {
  abstract insertSpan(span: SpanInsertData): Promise<void>;

  abstract insertSpans(spans: SpanInsertData[]): Promise<void>;
}
