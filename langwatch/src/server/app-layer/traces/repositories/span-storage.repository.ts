import type { SpanInsertData } from "../types";
import type { Span, ElasticSearchEvent } from "~/server/tracer/types";

export interface SpanSummaryRow {
  spanId: string;
  parentSpanId: string | null;
  spanName: string;
  durationMs: number;
  statusCode: number | null;
  spanType: string | null;
  model: string | null;
  startTimeMs: number;
}

/**
 * Raw OTel resource + scope info per span. The mapping to `Span` drops
 * `resourceAttributes` and `instrumentationScope`, so consumers (drawer
 * metadata, scope chip) need this dedicated read path.
 */
export interface SpanResourceInfo {
  spanId: string;
  parentSpanId: string | null;
  startTimeMs: number;
  resourceAttributes: Record<string, string>;
  scopeName: string | null;
  scopeVersion: string | null;
}

export interface SpanStorageRepository {
  insertSpan(span: SpanInsertData): Promise<void>;
  insertSpans(spans: SpanInsertData[]): Promise<void>;
  getSpansByTraceId(params: { tenantId: string; traceId: string }): Promise<Span[]>;
  getEventsByTraceId(params: { tenantId: string; traceId: string }): Promise<ElasticSearchEvent[]>;
  getSpanSummaryByTraceId(params: { tenantId: string; traceId: string }): Promise<SpanSummaryRow[]>;
  getSpanResourcesByTraceId(params: { tenantId: string; traceId: string }): Promise<SpanResourceInfo[]>;
  findSpanSummariesPaginated(params: {
    tenantId: string;
    traceId: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: SpanSummaryRow[]; total: number }>;
  findSpanSummariesSince(params: {
    tenantId: string;
    traceId: string;
    sinceStartTimeMs: number;
  }): Promise<SpanSummaryRow[]>;
  findSpansPaginated(params: {
    tenantId: string;
    traceId: string;
    limit: number;
    offset: number;
  }): Promise<{ spans: Span[]; total: number }>;
  findSpansSince(params: {
    tenantId: string;
    traceId: string;
    sinceStartTimeMs: number;
  }): Promise<Span[]>;
}

export class NullSpanStorageRepository implements SpanStorageRepository {
  async insertSpan(_span: SpanInsertData): Promise<void> {}
  async insertSpans(_spans: SpanInsertData[]): Promise<void> {}

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

  async getSpanSummaryByTraceId(
    _params: { tenantId: string; traceId: string },
  ): Promise<SpanSummaryRow[]> {
    return [];
  }

  async getSpanResourcesByTraceId(
    _params: { tenantId: string; traceId: string },
  ): Promise<SpanResourceInfo[]> {
    return [];
  }

  async findSpanSummariesPaginated(
    _params: { tenantId: string; traceId: string; limit: number; offset: number },
  ): Promise<{ rows: SpanSummaryRow[]; total: number }> {
    return { rows: [], total: 0 };
  }

  async findSpanSummariesSince(
    _params: { tenantId: string; traceId: string; sinceStartTimeMs: number },
  ): Promise<SpanSummaryRow[]> {
    return [];
  }

  async findSpansPaginated(
    _params: { tenantId: string; traceId: string; limit: number; offset: number },
  ): Promise<{ spans: Span[]; total: number }> {
    return { spans: [], total: 0 };
  }

  async findSpansSince(
    _params: { tenantId: string; traceId: string; sinceStartTimeMs: number },
  ): Promise<Span[]> {
    return [];
  }
}
