import type { SpanInsertData } from "../types";
import type { Span, ElasticSearchEvent } from "~/server/tracer/types";

export interface SpanStorageRepository {
  insertSpan(span: SpanInsertData): Promise<void>;
  getSpansByTraceId(params: { tenantId: string; traceId: string }): Promise<Span[]>;
  getEventsByTraceId(params: { tenantId: string; traceId: string }): Promise<ElasticSearchEvent[]>;
}

export class NullSpanStorageRepository implements SpanStorageRepository {
  async insertSpan(_span: SpanInsertData): Promise<void> {}

  async getSpansByTraceId(
    _params: { tenantId: string; traceId: string },
  ): Promise<Span[]> {
    return [];
  }

  async getEventsByTraceId(
    _params: { tenantId: string; traceId: string },
  ): Promise<ElasticSearchEvent[]> {
    return [];
  }
}
