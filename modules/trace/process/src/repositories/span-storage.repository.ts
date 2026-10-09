import type { Authorization } from "@langwatch/authorization";
import type {
  DerivedTraceEvent,
  ModelSpanSampleRow,
  ModelUsageStatsRow,
  SpanResourceInfo,
  SpanSummaryRow,
  TraceEventRollup,
  NormalizedSpan,
  ElasticSearchEvent,
  Span,
  SpanInsertData,
} from "@langwatch/trace-contract";

export type { ModelSpanSampleRow, ModelUsageStatsRow } from "@langwatch/trace-contract";

// Safety ceiling for read-time derivations; prevents unbounded reads on pathological trace_ids
export const MAX_DERIVATION_SPANS = 512;

// Safety ceiling for light per-trace projections that materialize all rows at once
export const MAX_LIGHT_SPAN_READ_ROWS = 10_000;

// Per-trace ceiling for findStoredSpansByTraceId: the prompt playground's span ceiling
export const MAX_STORED_TRACE_SPAN_ROWS = 1000;

/** A trace's span with its attributes as stored (strings, never parsed back: "0042" stays "0042"). */
export interface StoredTraceSpan {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  spanAttributes: Record<string, string>;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  durationMs: number;
  statusCode: number | null;
  statusMessage: string | null;
}

// Distinct event name ceiling for instrumentation that mints fresh names per call site
export const MAX_EVENT_NAMES_PER_TRACE = 12;

export interface TraceEventRollupParams {
  authorization: Authorization;
  /** The visible page's trace ids. An empty list issues no query. */
  traceIds: string[];
  /**
   * The list's time range. Every trace on the page occurred inside it, so the
   * read is padded by {@link DEFAULT_PARTITION_WINDOW_MS} and pruned to those
   * partitions rather than scanning every week including the cold tier.
   */
  timeRange: { from: number; to: number };
}

/**
 * Ordered list of LangWatch signal buckets projected per-span — a flat
 * array of names, one per active bucket, fixed order. Empty means no
 * LangWatch-instrumented attributes are surfaced in the UI.
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
 * Optional partition-pruning hint. stored_spans partitions by
 * toYearWeek(StartTime); an approximate timestamp restricts the scan to a
 * small window instead of walking every weekly partition (incl. cold S3).
 */
export interface OccurredAtHint {
  occurredAtMs?: number;
}

// @see ADR-069 — partition hint is REQUIRED here for windowed claim-check reads
export interface NormalizedSpanByIdParams {
  authorization: Authorization;
  traceId: string;
  spanId: string;
  /** Centre of the partition window: the SPAN'S OWN start, epoch ms. */
  occurredAtMs: number;
}

/**
 * Writes name their tenant on the row. Every read takes the sealed ADR-166
 * `authorization` proof instead: the store client fences the statement to the
 * projects the proof covers, never a tenant predicate of its own (ADR-177 block C).
 */
export abstract class SpanStorageRepository {
  abstract insertSpan(span: SpanInsertData): Promise<void>;
  abstract insertSpans(spans: SpanInsertData[]): Promise<void>;
  /**
   * Full spans for a trace. Bounded by `MAX_DERIVATION_SPANS` (hard ceiling,
   * always applied) so no caller can make this read unbounded on a leaked
   * trace_id. `limit` may only lower the bound.
   */
  abstract findSpansByTraceId(
    params: {
      authorization: Authorization;
      traceId: string;
      limit?: number;
    } & OccurredAtHint,
  ): Promise<Span[]>;
  /**
   * Normalized spans for a trace, for read-time derivations (trace events +
   * scenario role cost/latency), bounded by MAX_DERIVATION_SPANS. Property-
   * typed so a test mock can be asserted on without an unbound extraction.
   */
  abstract findNormalizedSpansByTraceId: (
    params: {
      authorization: Authorization;
      traceId: string;
      limit?: number;
    } & OccurredAtHint,
  ) => Promise<NormalizedSpan[]>;
  /**
   * A trace's spans with their attributes as stored, unparsed. Same scope and partition
   * hint as {@link findNormalizedSpansByTraceId}, bounded by MAX_STORED_TRACE_SPAN_ROWS.
   */
  abstract findStoredSpansByTraceId(
    params: {
      authorization: Authorization;
      traceId: string;
      limit?: number;
    } & OccurredAtHint,
  ): Promise<StoredTraceSpan[]>;
  abstract findSpanByIds(
    params: {
      authorization: Authorization;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<Span | null>;
  /**
   * @see ADR-069
   * Claim-check resolution read: one canonical span by identity, windowed
   * with no unbounded fallback — a miss stays cheap via queue retry.
   * Derivation-shaped: empty events/links; use findSpanByIds for a whole span.
   */
  abstract findNormalizedSpanById(params: NormalizedSpanByIdParams): Promise<NormalizedSpan | null>;
  /**
   * Trace-level events ({spanId, timestamp, name, attributes}) for the
   * trace-detail read, derived from spans' OTel events (ARRAY JOIN over
   * Events.*, no heavy attribute scan) — far cheaper than fetching whole spans.
   */
  abstract findTraceEventsByTraceId(
    params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<DerivedTraceEvent[]>;
  /**
   * Event rollups for a page of traces (the list's Events column). Same
   * Events.* ARRAY JOIN as {@link findTraceEventsByTraceId}, batched across
   * the page in one query — a badge needs only a name and count.
   */
  abstract findTraceEventRollupsByTraceIds(
    params: TraceEventRollupParams,
  ): Promise<Record<string, TraceEventRollup>>;
  abstract findEventsByTraceId(
    params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]>;
  abstract findSpanEvents(
    params: {
      authorization: Authorization;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]>;
  abstract findSpanSummaryByTraceId(
    params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<SpanSummaryRow[]>;
  /**
   * Per-span LangWatch instrumentation signals — projected separately from
   * the main span tree so the cheap waterfall/list payload doesn't pay for
   * the attribute scan. Callers fire this in parallel and merge in the UI.
   */
  abstract findLangwatchSignalsByTraceId(
    params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<SpanLangwatchSignalsRow[]>;
  abstract findSpanResourcesByTraceId(
    params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<SpanResourceInfo[]>;
  abstract listSpansPaginated(
    params: {
      authorization: Authorization;
      traceId: string;
      limit: number;
      offset: number;
    } & OccurredAtHint,
  ): Promise<{ spans: Span[]; total: number }>;
  abstract findSpansSince(
    params: {
      authorization: Authorization;
      traceId: string;
      sinceStartTimeMs: number;
    } & OccurredAtHint,
  ): Promise<Span[]>;
  /**
   * Distinct model names seen on the tenant's spans since `fromMs`, with
   * span counts, ordered by traffic. Cross-trace by design (no traceId),
   * the model cost rule preview needs the project-wide model inventory.
   */
  abstract findModelUsageStats(params: {
    authorization: Authorization;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]>;
  /**
   * Most recent spans whose model is one of `models`, capped per model so a
   * single chatty model can't crowd the sample list. Spans carrying token
   * usage are preferred over token-less ones.
   */
  abstract findRecentSpansByModels(params: {
    authorization: Authorization;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]>;
  /**
   * Clamps a requested span-read limit to [1, max] (default
   * MAX_DERIVATION_SPANS). Ceiling is hard — callers can only lower it.
   * Missing/non-finite limit defaults to the ceiling, never a CH UInt32 param.
   */
  static clampSpanReadLimit(
    limit?: number,
    { max = MAX_DERIVATION_SPANS }: { max?: number } = {},
  ): number {
    const requested = Number.isFinite(limit) ? (limit as number) : max;
    return Math.min(Math.max(1, Math.trunc(requested)), max);
  }
}

export class NullSpanStorageRepository implements SpanStorageRepository {
  async insertSpan(_span: SpanInsertData): Promise<void> {
    // No-op storage.
  }
  async insertSpans(_spans: SpanInsertData[]): Promise<void> {
    // No-op storage.
  }

  async findSpansByTraceId(
    _params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<Span[]> {
    return [];
  }

  async findNormalizedSpansByTraceId(
    _params: {
      authorization: Authorization;
      traceId: string;
      limit?: number;
    } & OccurredAtHint,
  ): Promise<NormalizedSpan[]> {
    return [];
  }

  async findStoredSpansByTraceId(
    _params: {
      authorization: Authorization;
      traceId: string;
      limit?: number;
    } & OccurredAtHint,
  ): Promise<StoredTraceSpan[]> {
    return [];
  }

  async findNormalizedSpanById(_params: NormalizedSpanByIdParams): Promise<NormalizedSpan | null> {
    return null;
  }

  async findSpanByIds(
    _params: {
      authorization: Authorization;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<Span | null> {
    return null;
  }

  async findTraceEventsByTraceId(
    _params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<DerivedTraceEvent[]> {
    return [];
  }

  async findTraceEventRollupsByTraceIds(
    _params: TraceEventRollupParams,
  ): Promise<Record<string, TraceEventRollup>> {
    return {};
  }

  async findEventsByTraceId(
    _params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]> {
    return [];
  }

  async findSpanEvents(
    _params: {
      authorization: Authorization;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]> {
    return [];
  }

  async findSpanSummaryByTraceId(
    _params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<SpanSummaryRow[]> {
    return [];
  }

  async findLangwatchSignalsByTraceId(
    _params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<SpanLangwatchSignalsRow[]> {
    return [];
  }

  async findSpanResourcesByTraceId(
    _params: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<SpanResourceInfo[]> {
    return [];
  }

  async listSpansPaginated(
    _params: {
      authorization: Authorization;
      traceId: string;
      limit: number;
      offset: number;
    } & OccurredAtHint,
  ): Promise<{ spans: Span[]; total: number }> {
    return { spans: [], total: 0 };
  }

  async findSpansSince(
    _params: {
      authorization: Authorization;
      traceId: string;
      sinceStartTimeMs: number;
    } & OccurredAtHint,
  ): Promise<Span[]> {
    return [];
  }

  async findModelUsageStats(_params: {
    authorization: Authorization;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]> {
    return [];
  }

  async findRecentSpansByModels(_params: {
    authorization: Authorization;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]> {
    return [];
  }
}
