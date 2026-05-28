import type { ElasticSearchEvent, Span } from "~/server/tracer/types";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import type { SpanInsertData } from "../types";

/**
 * Per-trace safety ceiling for read-time derivation queries (trace events +
 * scenario role costs derived from stored_spans). Production span-count per
 * trace is p999=312, so this covers >99.9% of real traces; it exists only so a
 * pathological leaked/looping trace_id (seen up to ~27k spans) can never make a
 * single derivation read unbounded. Below the ceiling derivations are exact;
 * above it only the hoisted trace-event list and scenario summary metrics
 * truncate, while the paginated span detail view is a separate query and stays
 * complete.
 */
export const MAX_DERIVATION_SPANS = 512;

/**
 * Clamps a requested span-read limit to the `[1, MAX_DERIVATION_SPANS]` range.
 * `MAX_DERIVATION_SPANS` is a hard ceiling a caller can only lower, never raise,
 * so every full-span / derivation read is bounded even for a leaked trace_id.
 * A missing or non-finite limit (undefined, NaN, Infinity) defaults to the
 * ceiling so the value never propagates into a ClickHouse `UInt32` param.
 */
export function clampSpanReadLimit(limit?: number): number {
  const requested = Number.isFinite(limit) ? (limit as number) : MAX_DERIVATION_SPANS;
  return Math.min(Math.max(1, Math.trunc(requested)), MAX_DERIVATION_SPANS);
}

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
 * The ordered list of LangWatch signal buckets we project per-span. The
 * shape is a flat array of bucket names so the wire payload stays tiny —
 * one entry per active bucket, in fixed order. Empty array means the span
 * carries no LangWatch-instrumented attributes we surface in the UI.
 */
export const LANGWATCH_SIGNAL_BUCKETS = [
  "prompt",
  "scenario",
  "user",
  "thread",
  "evaluation",
  "rag",
  "metadata",
  "genai",
] as const;

export type LangwatchSignalBucket = (typeof LANGWATCH_SIGNAL_BUCKETS)[number];

export interface SpanLangwatchSignalsRow {
  spanId: string;
  signals: LangwatchSignalBucket[];
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
  /**
   * Full spans for a trace. Bounded by `MAX_DERIVATION_SPANS` (hard ceiling,
   * always applied) so no caller can make this read unbounded on a leaked
   * trace_id. `limit` may only lower the bound.
   */
  getSpansByTraceId(
    params: { tenantId: string; traceId: string; limit?: number } & OccurredAtHint,
  ): Promise<Span[]>;
  /**
   * Normalized spans for a trace, used by read-time derivations (trace events
   * + scenario role cost/latency) that need the canonicalized span attributes
   * and parent links. Bounded by `MAX_DERIVATION_SPANS` so a pathological
   * trace can't make the derivation read unbounded.
   */
  getNormalizedSpansByTraceId(
    params: { tenantId: string; traceId: string; limit?: number } & OccurredAtHint,
  ): Promise<NormalizedSpan[]>;
  getSpanByIds(
    params: {
      tenantId: string;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<Span | null>;
  /**
   * Trace-level events ({spanId, timestamp, name, attributes}) for the
   * trace-detail read, derived from the spans' OTel events. Events-only
   * (ARRAY JOIN over the `Events.*` columns, no heavy span attribute scan),
   * so it is far cheaper than fetching whole spans. Includes exception events
   * for parity with the list the fold used to carry.
   */
  getTraceEventsByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<DerivedTraceEvent[]>;
  getEventsByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]>;
  getSpanEvents(
    params: {
      tenantId: string;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]>;
  getSpanSummaryByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanSummaryRow[]>;
  /**
   * Per-span LangWatch instrumentation signals — projected separately from
   * the main span tree so the cheap waterfall/list payload doesn't pay for
   * the attribute scan. Callers fire this in parallel and merge in the UI.
   */
  findLangwatchSignalsByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanLangwatchSignalsRow[]>;
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

  async getNormalizedSpansByTraceId(
    _params: { tenantId: string; traceId: string; limit?: number } & OccurredAtHint,
  ): Promise<NormalizedSpan[]> {
    return [];
  }

  async getSpanByIds(
    _params: {
      tenantId: string;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<Span | null> {
    return null;
  }

  async getTraceEventsByTraceId(
    _params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<DerivedTraceEvent[]> {
    return [];
  }

  async getEventsByTraceId(
    _params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]> {
    return [];
  }

  async getSpanEvents(
    _params: {
      tenantId: string;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]> {
    return [];
  }

  async getSpanSummaryByTraceId(
    _params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanSummaryRow[]> {
    return [];
  }

  async findLangwatchSignalsByTraceId(
    _params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanLangwatchSignalsRow[]> {
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
