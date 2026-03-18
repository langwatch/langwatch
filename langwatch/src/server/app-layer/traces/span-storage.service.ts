import type { Span, ElasticSearchEvent } from "~/server/tracer/types";
import type { SpanStorageRepository } from "./repositories/span-storage.repository";
import type { SpanInsertData } from "./types";

export class SpanStorageService {
  constructor(readonly repository: SpanStorageRepository) {}

  async insertSpan(span: SpanInsertData): Promise<void> {
    await this.repository.insertSpan(span);
  }

  async getSpansByTraceId({ tenantId, traceId }: { tenantId: string; traceId: string }): Promise<Span[]> {
    return this.repository.getSpansByTraceId({ tenantId, traceId });
  }

  async getEventsByTraceId({ tenantId, traceId }: { tenantId: string; traceId: string }): Promise<ElasticSearchEvent[]> {
    return this.repository.getEventsByTraceId({ tenantId, traceId });
  }
}
