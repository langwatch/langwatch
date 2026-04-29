import type { ElasticSearchEvent, Span } from "~/server/tracer/types";
import type {
  OccurredAtHint,
  SpanLangwatchSignalsRow,
  SpanResourceInfo,
  SpanStorageRepository,
  SpanSummaryRow,
} from "./repositories/span-storage.repository";
import type { SpanInsertData } from "./types";

type ByTraceId = { tenantId: string; traceId: string } & OccurredAtHint;
type BySpanId = ByTraceId & { spanId: string };
type Paginated = ByTraceId & { limit: number; offset: number };
type Since = ByTraceId & { sinceStartTimeMs: number };

export class SpanStorageService {
  constructor(readonly repository: SpanStorageRepository) {}

  async insertSpan(span: SpanInsertData): Promise<void> {
    await this.repository.insertSpan(span);
  }

  async getSpansByTraceId(params: ByTraceId): Promise<Span[]> {
    return this.repository.getSpansByTraceId(params);
  }

  async getSpanById(params: BySpanId): Promise<Span | null> {
    return this.repository.getSpanByIds(params);
  }

  async getEventsByTraceId(params: ByTraceId): Promise<ElasticSearchEvent[]> {
    return this.repository.getEventsByTraceId(params);
  }

  async getSpanEvents(params: BySpanId): Promise<ElasticSearchEvent[]> {
    return this.repository.getSpanEvents(params);
  }

  async getSpanSummaryByTraceId(params: ByTraceId): Promise<SpanSummaryRow[]> {
    return this.repository.getSpanSummaryByTraceId(params);
  }

  async getLangwatchSignalsByTraceId(
    params: ByTraceId,
  ): Promise<SpanLangwatchSignalsRow[]> {
    return this.repository.findLangwatchSignalsByTraceId(params);
  }

  async getSpanResourcesByTraceId(
    params: ByTraceId,
  ): Promise<SpanResourceInfo[]> {
    return this.repository.findSpanResourcesByTraceId(params);
  }

  async getSpansPaginated(
    params: Paginated,
  ): Promise<{ spans: Span[]; total: number }> {
    return this.repository.findSpansPaginated(params);
  }

  async getSpansSince(params: Since): Promise<Span[]> {
    return this.repository.findSpansSince(params);
  }

  async getSpanSummariesPaginated(
    params: Paginated,
  ): Promise<{ rows: SpanSummaryRow[]; total: number }> {
    return this.repository.findSpanSummariesPaginated(params);
  }

  async getSpanSummariesSince(params: Since): Promise<SpanSummaryRow[]> {
    return this.repository.findSpanSummariesSince(params);
  }
}
