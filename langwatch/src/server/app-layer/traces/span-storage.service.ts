import type { Span, ElasticSearchEvent } from "~/server/tracer/types";
import type {
  SpanResourceInfo,
  SpanStorageRepository,
  SpanSummaryRow,
} from "./repositories/span-storage.repository";
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

  async getSpanSummaryByTraceId({ tenantId, traceId }: { tenantId: string; traceId: string }): Promise<SpanSummaryRow[]> {
    return this.repository.getSpanSummaryByTraceId({ tenantId, traceId });
  }

  async getSpanResourcesByTraceId({
    tenantId,
    traceId,
  }: {
    tenantId: string;
    traceId: string;
  }): Promise<SpanResourceInfo[]> {
    return this.repository.getSpanResourcesByTraceId({ tenantId, traceId });
  }

  async getSpansPaginated({
    tenantId,
    traceId,
    limit,
    offset,
  }: {
    tenantId: string;
    traceId: string;
    limit: number;
    offset: number;
  }): Promise<{ spans: Span[]; total: number }> {
    return this.repository.findSpansPaginated({ tenantId, traceId, limit, offset });
  }

  async getSpansSince({
    tenantId,
    traceId,
    sinceStartTimeMs,
  }: {
    tenantId: string;
    traceId: string;
    sinceStartTimeMs: number;
  }): Promise<Span[]> {
    return this.repository.findSpansSince({ tenantId, traceId, sinceStartTimeMs });
  }

  async getSpanSummariesPaginated({
    tenantId,
    traceId,
    limit,
    offset,
  }: {
    tenantId: string;
    traceId: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: SpanSummaryRow[]; total: number }> {
    return this.repository.findSpanSummariesPaginated({ tenantId, traceId, limit, offset });
  }

  async getSpanSummariesSince({
    tenantId,
    traceId,
    sinceStartTimeMs,
  }: {
    tenantId: string;
    traceId: string;
    sinceStartTimeMs: number;
  }): Promise<SpanSummaryRow[]> {
    return this.repository.findSpanSummariesSince({ tenantId, traceId, sinceStartTimeMs });
  }
}
