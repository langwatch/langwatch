import type {
  DerivedTraceEvent,
  SpanResourceInfo,
  SpanSummaryRow,
  TraceEventRollup,
} from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import type { ElasticSearchEvent, Span } from "@langwatch/trace-contract";
import type { SpanInsertData } from "@langwatch/trace-contract";

/**
 * Per-trace safety ceiling for read-time derivation queries (trace events + scenario role costs). Production p999 span-count per trace is 312, so this covers >99.9% of real traces; exists only so a pathological leaked/looping trace_id (seen up to ~27k spans) can't make a derivation read unbounded. Below the ceiling derivations are exact; above it only the hoisted event list/scenario metrics truncate — the paginated span detail view is a separate, complete query.
 */
export const MAX_DERIVATION_SPANS = 512;

/**
 * Per-query safety ceiling for light single-shot per-trace projections (span summaries, signal keys, resource info, events, summary deltas). Rows are slim (no SpanAttributes values, I/O, Events payloads), so the ceiling is generous, but traces have been seen with 20k-100k+ spans and an unbounded read materializes every row at once. The complete view of huge traces is the Trace feature's cursor-paged span-tree read, needing only one page in memory.
 */
export const MAX_LIGHT_SPAN_READ_ROWS = 10_000;

/**
 * How many distinct event names one trace contributes to a list-page rollup — a distinct-name ceiling, not an event ceiling (474 tool.output events is one entry). Exists for instrumentation minting a fresh name per call site (an OTel bridge naming events after file.rs:236 produces dozens per trace), where the untrimmed list would be neither renderable nor useful. totalCount/distinctCount are computed before the trim, so a trimmed rollup still reports its true size.
 */
export const MAX_EVENT_NAMES_PER_TRACE = 12;

export interface TraceEventRollupParams {
  tenantId: string;
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
 * Ordered list of LangWatch signal buckets projected per-span — a flat array of bucket names so the wire payload stays tiny, one entry per active bucket, fixed order. Empty means the span carries no LangWatch-instrumented attributes surfaced in the UI.
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
 * Optional partition-pruning hint. stored_spans is partitioned by toYearWeek(StartTime); an approximate trace timestamp lets the repo restrict the scan to a small window instead of walking every weekly partition (cold S3 included).
 */
export interface OccurredAtHint {
  occurredAtMs?: number;
}

/**
 * @see ADR-069
 * Params for the claim-check resolution read. The partition hint is REQUIRED here, unlike the optional {@link OccurredAtHint} every other read takes — this one runs fallback:"none", and a windowed read with no hint has no narrow window to accept, so it'd run the unbounded scan the read exists to avoid. Making the hint part of the contract keeps that promise for the next adopter.
 */
export interface NormalizedSpanByIdParams {
  tenantId: string;
  traceId: string;
  spanId: string;
  /** Centre of the partition window: the SPAN'S OWN start, epoch ms. */
  occurredAtMs: number;
}

/**
 * Per-model usage rollup over a recent window, feeds the model cost rule
 * preview ("which models would this regex match, and how much traffic do
 * they carry").
 */
export interface ModelUsageStatsRow {
  model: string;
  spanCount: number;
  lastSeenMs: number;
}

/**
 * Light per-span sample for the model cost rule preview list. Token counts
 * are null when the span carries no usage attributes.
 */
export interface ModelSpanSampleRow {
  traceId: string;
  spanId: string;
  spanName: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  /** The portion of the writes that bought an hour-long cache entry. */
  cacheCreation1hTokens: number | null;
  startTimeMs: number;
}

export abstract class SpanStorageRepository {
  abstract insertSpan(span: SpanInsertData): Promise<void>;
  abstract insertSpans(spans: SpanInsertData[]): Promise<void>;
  /**
   * Full spans for a trace. Bounded by `MAX_DERIVATION_SPANS` (hard ceiling,
   * always applied) so no caller can make this read unbounded on a leaked
   * trace_id. `limit` may only lower the bound.
   */
  abstract getSpansByTraceId(
    params: {
      tenantId: string;
      traceId: string;
      limit?: number;
    } & OccurredAtHint,
  ): Promise<Span[]>;
  /**
   * Normalized spans for a trace, used by read-time derivations (trace events + scenario role cost/latency) needing canonicalized attributes and parent links. Bounded by MAX_DERIVATION_SPANS so a pathological trace can't make the read unbounded.
   */
  abstract getNormalizedSpansByTraceId(
    params: {
      tenantId: string;
      traceId: string;
      limit?: number;
    } & OccurredAtHint,
  ): Promise<NormalizedSpan[]>;
  abstract tryGetSpanByIds(
    params: {
      tenantId: string;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<Span | null>;
  /**
   * @see ADR-069
   * Claim-check resolution read: one canonical span by identity, windowed by the reference's partition hint with no unbounded fallback — a miss stays cheap since the caller retries via the queue. Derivation-shaped: the returned span carries empty events/links; a caller needing a whole span wants tryGetSpanByIds.
   */
  abstract tryFindNormalizedSpanById(
    params: NormalizedSpanByIdParams,
  ): Promise<NormalizedSpan | null>;
  /**
   * Trace-level events ({spanId, timestamp, name, attributes}) for the trace-detail read, derived from spans' OTel events. Events-only (ARRAY JOIN over Events.*, no heavy attribute scan), far cheaper than fetching whole spans. Includes exception events for parity with the fold's old list.
   */
  abstract getTraceEventsByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<DerivedTraceEvent[]>;
  /**
   * Event rollups for a page of traces, for the trace list's Events column. Same Events.* ARRAY JOIN as {@link getTraceEventsByTraceId}, grouped by name and batched across the page (one query, not one per row). Attributes aren't read — a badge needs only a name and count.
   */
  abstract getTraceEventRollupsByTraceIds(
    params: TraceEventRollupParams,
  ): Promise<Record<string, TraceEventRollup>>;
  abstract getEventsByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]>;
  abstract getSpanEvents(
    params: {
      tenantId: string;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<ElasticSearchEvent[]>;
  abstract getSpanSummaryByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanSummaryRow[]>;
  /**
   * Per-span LangWatch instrumentation signals — projected separately from
   * the main span tree so the cheap waterfall/list payload doesn't pay for
   * the attribute scan. Callers fire this in parallel and merge in the UI.
   */
  abstract findLangwatchSignalsByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanLangwatchSignalsRow[]>;
  abstract findSpanResourcesByTraceId(
    params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<SpanResourceInfo[]>;
  abstract findSpansPaginated(
    params: {
      tenantId: string;
      traceId: string;
      limit: number;
      offset: number;
    } & OccurredAtHint,
  ): Promise<{ spans: Span[]; total: number }>;
  abstract findSpansSince(
    params: {
      tenantId: string;
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
    tenantId: string;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]>;
  /**
   * Most recent spans whose model is one of `models`, capped per model so a
   * single chatty model can't crowd the sample list. Spans carrying token
   * usage are preferred over token-less ones.
   */
  abstract findRecentSpansByModels(params: {
    tenantId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]>;
  /**
   * Clamps a requested span-read limit to [1, max] (default MAX_DERIVATION_SPANS). Ceiling is hard — a caller can only lower it, never raise it. Missing/non-finite limit (undefined, NaN, Infinity) defaults to the ceiling so it never propagates into a CH UInt32 param.
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

  async getSpansByTraceId(
    _params: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<Span[]> {
    return [];
  }

  async getNormalizedSpansByTraceId(
    _params: {
      tenantId: string;
      traceId: string;
      limit?: number;
    } & OccurredAtHint,
  ): Promise<NormalizedSpan[]> {
    return [];
  }

  async tryFindNormalizedSpanById(
    _params: NormalizedSpanByIdParams,
  ): Promise<NormalizedSpan | null> {
    return null;
  }

  async tryGetSpanByIds(
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

  async getTraceEventRollupsByTraceIds(
    _params: TraceEventRollupParams,
  ): Promise<Record<string, TraceEventRollup>> {
    return {};
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

  async findModelUsageStats(_params: {
    tenantId: string;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]> {
    return [];
  }

  async findRecentSpansByModels(_params: {
    tenantId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]> {
    return [];
  }
}
