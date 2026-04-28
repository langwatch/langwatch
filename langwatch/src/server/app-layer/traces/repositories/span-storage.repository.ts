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

/**
 * Optional partition-pruning hint. `stored_spans` is partitioned by
 * `toYearWeek(StartTime)`; supplying an approximate trace timestamp lets the
 * repo restrict the scan to a small window around it instead of walking
 * every weekly partition (including cold S3 tier).
 */
export interface OccurredAtHint {
  occurredAtMs?: number;
}

export interface SpanStorageRepository {
  insertSpan(span: SpanInsertData): Promise<void>;
  insertSpans(spans: SpanInsertData[]): Promise<void>;
  getSpansByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<Span[]>;
  getSpanByIds(
    params: { tenantId: string; traceId: string; spanId: string } & OccurredAtHint,
  ): Promise<Span | null>;
  getEventsByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]>;
  getSpanEvents(
    params: { tenantId: string; traceId: string; spanId: string } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]>;
  getSpanSummaryByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanSummaryRow[]>;
  findSpanResourcesByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanResourceInfo[]>;
  findSpanSummariesPaginated(
    params: {
      tenantId: string;
      traceId: string;
      limit: number;
      offset: number;
    } & OccurredAtHint,
  ): Promise<{ rows: SpanSummaryRow[]; total: number }>;
  findSpanSummariesSince(
    params: {
      tenantId: string;
      traceId: string;
      sinceStartTimeMs: number;
    } & OccurredAtHint,
  ): Promise<SpanSummaryRow[]>;
  findSpansPaginated(
    params: {
      tenantId: string;
      traceId: string;
      limit: number;
      offset: number;
    } & OccurredAtHint,
  ): Promise<{ spans: Span[]; total: number }>;
  findSpansSince(
    params: {
      tenantId: string;
      traceId: string;
      sinceStartTimeMs: number;
    } & OccurredAtHint,
  ): Promise<Span[]>;
}

export class NullSpanStorageRepository implements SpanStorageRepository {
  async insertSpan(_span: SpanInsertData): Promise<void> {}
  async insertSpans(_spans: SpanInsertData[]): Promise<void> {}

  async getSpansByTraceId(
    _params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<Span[]> {
    return [];
  }

  async getSpanByIds(
    _params: { tenantId: string; traceId: string; spanId: string } & OccurredAtHint,
  ): Promise<Span | null> {
    return null;
  }

  async getEventsByTraceId(
    _params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]> {
    return [];
  }

  async getSpanEvents(
    _params: { tenantId: string; traceId: string; spanId: string } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]> {
    return [];
  }

  async getSpanSummaryByTraceId(
    _params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanSummaryRow[]> {
    return [];
  }

  async findSpanResourcesByTraceId(
    _params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanResourceInfo[]> {
    return [];
  }

  async findSpanSummariesPaginated(
    _params: {
      tenantId: string;
      traceId: string;
      limit: number;
      offset: number;
    } & OccurredAtHint,
  ): Promise<{ rows: SpanSummaryRow[]; total: number }> {
    return { rows: [], total: 0 };
  }

  async findSpanSummariesSince(
    _params: {
      tenantId: string;
      traceId: string;
      sinceStartTimeMs: number;
    } & OccurredAtHint,
  ): Promise<SpanSummaryRow[]> {
    return [];
  }

  async findSpansPaginated(
    _params: {
      tenantId: string;
      traceId: string;
      limit: number;
      offset: number;
    } & OccurredAtHint,
  ): Promise<{ spans: Span[]; total: number }> {
    return { spans: [], total: 0 };
  }

  async findSpansSince(
    _params: {
      tenantId: string;
      traceId: string;
      sinceStartTimeMs: number;
    } & OccurredAtHint,
  ): Promise<Span[]> {
    return [];
  }
}
