import type { DerivedTraceEvent } from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import type { ElasticSearchEvent, Span } from "@langwatch/trace-contract";
import type { SpanInsertData } from "@langwatch/trace-contract";

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
 * Clamps a requested span-read limit to the `[1, max]` range (default ceiling
 * `MAX_DERIVATION_SPANS`). The ceiling is hard — a caller can only lower it,
 * never raise it — so every span read is bounded even for a leaked trace_id.
 * A missing or non-finite limit (undefined, NaN, Infinity) defaults to the
 * ceiling so the value never propagates into a ClickHouse `UInt32` param.
 */
export function clampSpanReadLimit(
  limit?: number,
  { max = MAX_DERIVATION_SPANS }: { max?: number } = {},
): number {
  const requested = Number.isFinite(limit) ? (limit as number) : max;
  return Math.min(Math.max(1, Math.trunc(requested)), max);
}

/**
 * Per-query safety ceiling for the light single-shot per-trace projections
 * (span summaries, signal keys, resource info, trace events, summary deltas).
 * These rows are slim — no SpanAttributes values, input/output, or Events
 * payloads — so the ceiling is generous, but it exists because traces have
 * been seen with 20k–100k+ spans and an unbounded read materializes every
 * row in ClickHouse and Node at once. The complete view of huge traces is
 * the Trace feature's cursor-paged span-tree read, which never needs more
 * than one page in memory.
 */
export const MAX_LIGHT_SPAN_READ_ROWS = 10_000;

/**
 * How many distinct event names one trace contributes to a list-page rollup.
 *
 * A trace's events collapse to one entry per name, so this is a distinct-name
 * ceiling, not an event ceiling: 474 `tool.output` events are one entry. It
 * exists for instrumentation that mints a fresh name per call site (an OTel
 * bridge naming events after `file.rs:236` produces dozens per trace), where
 * the untrimmed list would be neither renderable nor useful. `totalCount` and
 * `distinctCount` are computed before the trim, so a trimmed rollup still
 * reports its true size.
 */
export const MAX_EVENT_NAMES_PER_TRACE = 12;

/** One event name a trace recorded, with how often and when it first fired. */
export interface TraceEventNameCount {
  name: string;
  count: number;
  /** Epoch ms of the earliest event under this name — the display order. */
  firstTimestamp: number;
}

/** A trace's events as the list renders them: named groups plus true totals. */
export interface TraceEventRollup {
  /**
   * Ordered by first occurrence, at most {@link MAX_EVENT_NAMES_PER_TRACE}
   * entries. Shorter than `distinctCount` when the trim bit.
   */
  names: TraceEventNameCount[];
  /** Every event the trace recorded, counting names beyond the trim. */
  totalCount: number;
  /** Distinct event names the trace recorded, counting those beyond the trim. */
  distinctCount: number;
}

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

export interface SpanSummaryRow {
  spanId: string;
  parentSpanId: string | null;
  spanName: string;
  durationMs: number;
  statusCode: number | null;
  spanType: string | null;
  /** Tool display name (`gen_ai.tool.name` ?? `tool_name`), tool spans only. */
  toolName: string | null;
  /** Claude model-call join key (`request_id`), llm_request spans only. */
  requestId: string | null;
  /** Claude prompt-pairing scope (`query_source`). */
  querySource: string | null;
  /** Tool-call join key (`tool_use_id` ?? `gen_ai.tool.call.id`). */
  toolUseId: string | null;
  model: string | null;
  /**
   * USD cost: `gen_ai.usage.cost` when the SDK reported one, otherwise
   * computed at read time from token counts × model pricing (same
   * cascade the trace-level fold uses). Null when neither yields a
   * value — most ingest paths only emit token counts, so without the
   * computed fallback the waterfall never had a per-span cost to show.
   */
  cost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  startTimeMs: number;
  /**
   * Row version, not span timing: bumped every time a span is re-projected.
   * The live delta poll keys off this rather than `startTimeMs`, because a
   * span updated in place (end time, duration, status, cost) keeps its start
   * time and a start-keyed poll could never see it.
   */
  updatedAtMs: number;
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

/**
 * Params for the claim-check resolution read (ADR-069). The partition hint is
 * REQUIRED here, unlike the optional {@link OccurredAtHint} every other read
 * takes: this one runs `fallback: "none"`, and a windowed read with no hint has
 * no narrow window to accept — it runs the unbounded scan the read exists to
 * avoid. Making the hint part of the contract keeps that promise true for the
 * next adopter instead of relying on every caller remembering to pass one.
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

export interface SpanStorageRepository {
  insertSpan(span: SpanInsertData): Promise<void>;
  insertSpans(spans: SpanInsertData[]): Promise<void>;
  /**
   * Full spans for a trace. Bounded by `MAX_DERIVATION_SPANS` (hard ceiling,
   * always applied) so no caller can make this read unbounded on a leaked
   * trace_id. `limit` may only lower the bound.
   */
  getSpansByTraceId(
    params: {
      tenantId: string;
      traceId: string;
      limit?: number;
    } & OccurredAtHint,
  ): Promise<Span[]>;
  /**
   * Normalized spans for a trace, used by read-time derivations (trace events
   * + scenario role cost/latency) that need the canonicalized span attributes
   * and parent links. Bounded by `MAX_DERIVATION_SPANS` so a pathological
   * trace can't make the derivation read unbounded.
   */
  getNormalizedSpansByTraceId(
    params: {
      tenantId: string;
      traceId: string;
      limit?: number;
    } & OccurredAtHint,
  ): Promise<NormalizedSpan[]>;
  getSpanByIds(
    params: {
      tenantId: string;
      traceId: string;
      spanId: string;
    } & OccurredAtHint,
  ): Promise<Span | null>;
  /**
   * Claim-check resolution read (ADR-069): one canonical span by identity,
   * windowed by the reference's partition hint with no unbounded fallback —
   * a miss stays cheap because the caller retries via the queue.
   *
   * Derivation-shaped: the returned span carries empty `events` and `links`.
   * Consumers of this read lift scalar span/resource attributes; a caller that
   * needs a whole span wants `getSpanByIds`.
   */
  findNormalizedSpanById(params: NormalizedSpanByIdParams): Promise<NormalizedSpan | null>;
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
  /**
   * Event rollups for a page of traces, for the trace list's Events column.
   *
   * Same `Events.*` ARRAY JOIN as {@link getTraceEventsByTraceId}, but grouped
   * by name and batched across the page so the list issues one query instead
   * of one per row. Attributes are not read: a badge needs a name and a count,
   * and the attribute map is the expensive part of an event.
   */
  getTraceEventRollupsByTraceIds(
    params: TraceEventRollupParams,
  ): Promise<Record<string, TraceEventRollup>>;
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
  /**
   * Distinct model names seen on the tenant's spans since `fromMs`, with
   * span counts, ordered by traffic. Cross-trace by design (no traceId),
   * the model cost rule preview needs the project-wide model inventory.
   */
  findModelUsageStats(params: {
    tenantId: string;
    fromMs: number;
    limit: number;
  }): Promise<ModelUsageStatsRow[]>;
  /**
   * Most recent spans whose model is one of `models`, capped per model so a
   * single chatty model can't crowd the sample list. Spans carrying token
   * usage are preferred over token-less ones.
   */
  findRecentSpansByModels(params: {
    tenantId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }): Promise<ModelSpanSampleRow[]>;
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

  async findNormalizedSpanById(_params: NormalizedSpanByIdParams): Promise<NormalizedSpan | null> {
    return null;
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
