import type { SpanInsertData } from "../types";
import type { Span } from "~/server/tracer/types";

export interface SpanStorageRepository {
  insertSpan(span: SpanInsertData): Promise<void>;
  getSpansByTraceId(tenantId: string, traceId: string): Promise<Span[]>;
}

export class NullSpanStorageRepository implements SpanStorageRepository {
  async insertSpan(_span: SpanInsertData): Promise<void> {}

  async getSpansByTraceId(
    _tenantId: string,
    _traceId: string,
  ): Promise<Span[]> {
    return [];
  }
}
