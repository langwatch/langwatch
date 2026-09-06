import type { FoldProjectionOptions, FoldProjectionStore } from "@langwatch/eventing";
import { AbstractFoldProjection, type FoldEventHandlers } from "@langwatch/eventing";
import {
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  type AnnotationAddedEvent,
  type AnnotationRemovedEvent,
  type AnnotationsBulkSyncedEvent,
  type LogContributedEvent,
  type LogRecordReceivedEvent,
  logContributedEventSchema,
  logRecordReceivedEventSchema,
  metricDataPointCorrelatedEventSchema,
  type MetricDataPointCorrelatedEvent,
  NON_BILLABLE_ATTR,
  type NormalizedSpan,
  type OriginResolvedEvent,
  originResolvedEventSchema,
  type SpanReceivedEvent,
  spanReceivedEventSchema,
  SYNTHETIC_TRACE_SPAN_NAMES,
  type TopicAssignedEvent,
  topicAssignedEventSchema,
  type TraceNameChangedEvent,
  traceNameChangedEventSchema,
} from "@langwatch/trace-contract";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE } from "@langwatch/trace-contract";
import { OUTPUT_SOURCE } from "../services/trace-io-accumulation.service";
import { TraceProjectionRuntimeService } from "../services/trace-projection-runtime.service";
import { trimAttributesForAnalytics } from "../rules/analytics-attribute-trim.rules";
import { anchorStorageTime, firstUsableAnchor } from "../rules/trace-storage-anchor.rules";
import {
  MAX_PROCESSED_SPANS,
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
  RESERVED_REASONING_TOKENS,
  TraceSummaryFoldProjection,
} from "./trace-summary.projection";

/**
 * Deterministic fold for the slim `trace_analytics` table: hoisted
 * dimensions, trimmed attributes. `storageAnchorMs` is frozen — the row's
 * partition/sort/TTL address — separate from the timing baseline.
 */

const traceAnalyticsEvents = [
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  logContributedEventSchema,
  metricDataPointCorrelatedEventSchema,
  originResolvedEventSchema,
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  traceNameChangedEventSchema,
] as const;

/**
 * Schema-snapshot version (calendar date), bumped on derivation/trim
 * changes. 2026-07-29 = ADR-071 step 3 split; NOT a refold trigger, see
 * {@link TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}.
 */
export const TRACE_ANALYTICS_PROJECTION_VERSION_LATEST = "2026-07-29" as const;

/**
 * The pre-split stamp — DECODED in place, not a store miss: rejecting it
 * would re-anchor the whole population from replay (ADR-071 consequences
 * 1-3). `OccurredAt` doubles as the correct `EarliestSpanStartMs` here.
 */
export const TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT = "2026-07-27" as const;

/**
 * How far OccurredAt (frozen anchor, ADR-071 step 3) may sit from a read's
 * business time: ±7 days, since a late annotation can arrive days later.
 */
export const TRACE_ANALYTICS_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many same-trace events one cycle may coalesce. Lower than the
 * platform default (500); must stay below MAX_APPLIED_EVENT_IDS.
 */
export const TRACE_ANALYTICS_COALESCE_MAX_BATCH = 128;

/**
 * The slim row in `trace_analytics`. Field names 1:1 to ClickHouse columns.
 * Heavy artifacts (ComputedInput/Output, Events/Links, …) intentionally absent.
 */
export interface TraceAnalyticsRow {
  tenantId: string;
  traceId: string;
  /** Schema-snapshot version (NOT the LWW dedup key — that is UpdatedAt,
   *  same as trace_summaries; migration 00039). */
  version: string;
  /**
   * The trace's STORAGE ANCHOR → `OccurredAt`: partition/sort/TTL key.
   * Since ADR-071 step 3, `state.storageAnchorMs` (frozen first-observed
   * time), NOT the running min of span starts — that's `earliestSpanStartMs`.
   */
  occurredAtMs: number;
  /**
   * The span timing baseline → `EarliestSpanStartMs`: earliest start across
   * non-synthetic spans, or 0 until one is folded. Its own column because
   * `OccurredAt` no longer carries it.
   */
  earliestSpanStartMs: number;
  createdAtMs: number;
  updatedAtMs: number;

  // Hoisted dimensions (typed root-level columns).
  traceName: string;
  topicId: string | null;
  subTopicId: string | null;
  userId: string | null;
  conversationId: string | null;
  customerId: string | null;
  origin: string;
  models: string[];
  labels: string[];

  // Metric scalars.
  totalCost: number | null;
  nonBilledCost: number | null;
  totalDurationMs: number;
  timeToFirstTokenMs: number | null;
  tokensPerSecond: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  hasError: boolean;
  hasAnnotation: boolean | null;

  // Trimmed Attributes map (post-trimAttributesForAnalytics).
  attributes: Record<string, string>;

  /**
   * The persistable-signal verdict. NOT a table column — readers derive it
   * via {@link TRACE_ANALYTICS_HAS_SIGNAL_SQL}. Monotonic: readers may
   * filter on the LATEST version's flag alone.
   */
  hasSignal: boolean;

  // ── Read-back state (ADR-066, migration 00056) ─────────────────────────
  // Not analytics columns — these round-trip the fold's working state so
  // store.tryGet() can decode the row without replaying event_log. The hoisted
  // dimension columns above (UserId / ConversationId / CustomerId / Origin /
  // Models / Labels / TraceName) double as read-back sources for the fold's
  // attribute map; these carry the state the slim row otherwise dropped.
  /** Spans seen — the MAX_PROCESSED_SPANS cap AND the persistable-signal gate. */
  spanCount: number;
  /** The id set behind HasAnnotation; the row kept only the boolean. */
  annotationIds: string[];
  /** Canonical root span start (0 = none yet); trace-name precedence gate. */
  rootSpanStartTimeMs: number;
  /** Trace name was claimed via the fallback (earliest-span) path. */
  traceNameFromFallback: boolean;
  /** Root metadata was claimed via the fallback path. */
  rootMetadataFromFallback: boolean;
  /** A user rename latched the name against later span-derived clobbering. */
  traceNameUserOverridden: boolean;
  /** The fold's out-of-order checkpoint (distinct from OccurredAt). */
  lastEventOccurredAt: number;
}

/**
 * Canonical reserved-attribute keys read off the accumulated attribute map.
 * Match the `dest` values in trace-attribute-accumulation.service.ts:62-87.
 */
export const TRACE_ANALYTICS_ATTR_KEYS = {
  USER_ID: "langwatch.user_id",
  CONVERSATION_ID: "gen_ai.conversation.id",
  CUSTOMER_ID: "langwatch.customer_id",
  ORIGIN: "langwatch.origin",
  LABELS: "langwatch.labels",
} as const;

// ─── Lean state type ────────────────────────────────────────────────

/**
 * In-memory accumulator for the slim fold: only what slim's handlers
 * read/write, plus internal bookkeeping that never reaches a column.
 */
export interface TraceAnalyticsData {
  // Keys
  traceId: string;
  /** Count of spans seen; used for the MAX_PROCESSED_SPANS cap + the
   *  persistable-signal check in the store. */
  spanCount: number;

  // Hoisted dims (the projection function reads these straight off state)
  topicId: string | null;
  subTopicId: string | null;
  traceName: string;
  models: string[];

  /**
   * The trace's STORAGE ANCHOR, epoch ms → `OccurredAt`. Seeded once, never
   * moved (ADR-071). Kept separate from `occurredAt` (span-only baseline) —
   * conflating the two once put log-only traces in a reaped TTL partition.
   */
  storageAnchorMs: number;

  // Metric scalars
  /**
   * The span timing baseline, epoch ms: the earliest start across the trace's
   * non-synthetic spans, 0 while none has been folded. SPAN-SEEDED ONLY — see
   * `storageAnchorMs` above for why a log record must not set it.
   */
  occurredAt: number;
  totalDurationMs: number;
  totalCost: number | null;
  nonBilledCost: number | null;
  totalPromptTokenCount: number | null;
  totalCompletionTokenCount: number | null;
  timeToFirstTokenMs: number | null;
  tokensPerSecond: number | null;
  containsErrorStatus: boolean;

  // Slim-derived from this list at projection time
  annotationIds: string[];

  // Attribute map (post-accumulation, pre-trim — trim runs at projection time)
  attributes: Record<string, string>;

  // ── Internal bookkeeping (never persisted, never projected) ──
  /** Start of the canonical root span. The name-resolution service uses this
   *  to disambiguate which root span wins. */
  rootSpanStartTimeMs?: number;
  /** Latches a user-supplied trace name so a later root-span arrival can't
   *  silently clobber it. */
  traceNameUserOverridden?: boolean;
  /** True when `traceName` was claimed via the fallback path (earliest span,
   *  no real root). Cleared when a real root arrives or a user rename lands. */
  traceNameFromFallback?: boolean;
  /** True when `rootSpanStartTimeMs` was claimed via the fallback path.
   *  Survives a user rename (the name disowns its fallback provenance, but
   *  the metadata stand-in is still in place). */
  rootMetadataFromFallback?: boolean;

  // Auto-managed by AbstractFoldProjection
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

/**
 * The storage-anchor rule lives in {@link ./services/storage-anchor.ts} —
 * shared with `traceSummary` (ADR-087) so a second copy can't drift.
 */

/**
 * Project the in-memory slim state into `TraceAnalyticsRow`. Pure: no I/O
 * beyond the injectable `now`, which a caller may pin.
 */
/**
 * {@link hasPersistableSignal} as a SQL predicate over existing columns. The
 * 4th door (version < pre-split) covers rows predating the 00056 columns.
 * Applied by every trace-table reader except the fold read-back.
 */
export const TRACE_ANALYTICS_HAS_SIGNAL_SQL =
  `(SpanCount > 0` +
  ` OR EarliestSpanStartMs > 0` +
  ` OR Attributes['langwatch.reserved.log_record_count'] NOT IN ('', '0')` +
  ` OR Version < '${TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}')`;

// ─── Service composition ────────────────────────────────────────────

/**
 * A single log record's normalized contribution to the slim fold.
 * `log_record_received` builds it from the raw record; `log_contributed`
 * carries the already-lifted fields.
 */
interface LogContribution {
  traceId: string;
  liftedAttributes: Record<string, unknown>;
  nonBillable: boolean;
}

// ─── Fold projection class ──────────────────────────────────────────

/**
 * Slim fold projection. Handlers call the same service CLASSES the
 * trace-summary fold uses, so both folds pick up service logic changes
 * automatically. Slim's role is orchestration only.
 */
export class TraceAnalyticsFoldProjection
  extends AbstractFoldProjection<
    TraceAnalyticsData,
    typeof traceAnalyticsEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements FoldEventHandlers<typeof traceAnalyticsEvents, TraceAnalyticsData>
{
  private readonly traceCanonicalisation: TraceCanonicalisationService;
  private readonly runtime: TraceProjectionRuntimeService;
  readonly name = "traceAnalytics";
  readonly version = TRACE_ANALYTICS_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<TraceAnalyticsData>;

  protected readonly events = traceAnalyticsEvents;

  /**
   * Rows round-trip fold state + watermark. Older shapes re-fold once, but
   * pre-storage-anchor rows are decoded to avoid re-anchoring the population.
   */
  override options: FoldProjectionOptions = {
    refoldOnStoreMiss: true,
    trustAbsentMiss: true,
    refoldOnOutOfOrder: false,
    readWindow: { widthMs: TRACE_ANALYTICS_READ_WINDOW_MS },
    coalesceMaxBatch: TRACE_ANALYTICS_COALESCE_MAX_BATCH,
  };

  private constructor(deps: {
    store: FoldProjectionStore<TraceAnalyticsData>;
    traceCanonicalisation: TraceCanonicalisationService;
    runtime: TraceProjectionRuntimeService;
  }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
    this.traceCanonicalisation = deps.traceCanonicalisation;
    this.runtime = deps.runtime;
  }

  static create(deps: {
    store: FoldProjectionStore<TraceAnalyticsData>;
    traceCanonicalisation: TraceCanonicalisationService;
    runtime: TraceProjectionRuntimeService;
  }): TraceAnalyticsFoldProjection {
    return new TraceAnalyticsFoldProjection(deps);
  }

  protected initState() {
    return {
      traceId: "",
      spanCount: 0,
      topicId: null,
      subTopicId: null,
      traceName: "",
      models: [],
      // Sentinel: 0 means "nothing observed yet". `apply` freezes it on the
      // first contribution carrying a usable business time.
      storageAnchorMs: 0,
      // Sentinel: 0 means "no spans received yet". The timing service uses
      // occurredAt > 0 to decide first-span vs min-of-existing. Using
      // Date.now() here would break the Math.min logic.
      occurredAt: 0,
      totalDurationMs: 0,
      totalCost: null,
      nonBilledCost: null,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      timeToFirstTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      annotationIds: [],
      attributes: {},
      rootSpanStartTimeMs: undefined,
      traceNameUserOverridden: false,
      traceNameFromFallback: false,
      rootMetadataFromFallback: false,
    };
  }

  /**
   * Dispatch, then freeze the storage anchor on the first contribution with
   * a usable business time (ADR-071 step 3). After `super.apply` so a span's
   * own start time wins over the ingest stamp.
   */
  override apply(state: TraceAnalyticsData, event: { type: string }): TraceAnalyticsData {
    const folded = super.apply(state, event);
    if (folded === state) return state;
    const eventOccurredAt = (event as { occurredAt?: unknown }).occurredAt;
    return anchorStorageTime({
      state: folded,
      eventOccurredAtMs: typeof eventOccurredAt === "number" ? eventOccurredAt : undefined,
    });
  }

  handleTraceSpanReceived(event: SpanReceivedEvent, state: TraceAnalyticsData): TraceAnalyticsData {
    // Past the processing cap, keep counting but skip the expensive
    // normalization + derivation. Mirrors the trace-summary fold so the cap
    // boundary triggers in both folds at the same span.
    if (state.spanCount >= MAX_PROCESSED_SPANS) {
      return { ...state, spanCount: state.spanCount + 1 };
    }

    const normalizedSpan = this.runtime.spanNormalization.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
    this.runtime.spanNormalization.enrichRagContextIds(normalizedSpan);

    return TraceAnalyticsFoldProjection.applySpanToAnalytics({
      state,
      span: normalizedSpan,
      runtime: this.runtime,
    });
  }

  handleTraceTopicAssigned(
    event: TopicAssignedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    return {
      ...state,
      topicId: event.data.topicId ?? state.topicId,
      subTopicId: event.data.subtopicId ?? state.subTopicId,
    };
  }

  handleTraceLogRecordReceived(
    event: LogRecordReceivedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    // Mirrors the trace-summary fold: standalone OTLP logs (no trace
    // context) are accepted on the wire, but skipped here so they don't aggregate per
    // tenant under a single empty aggregateId.
    if (!event.data.traceId || !event.data.spanId) {
      return state;
    }

    const liftedAttributes = this.traceCanonicalisation.canonicalizeLogRecord({
      scopeName: event.data.scopeName,
      body: event.data.body,
      attributes: event.data.attributes,
    }).attributes;

    return TraceAnalyticsFoldProjection.applyLogContribution({
      state,
      runtime: this.runtime,
      contribution: {
        traceId: event.data.traceId,
        liftedAttributes,
        nonBillable: event.data.resourceAttributes?.[NON_BILLABLE_ATTR] === "true",
      },
    });
  }

  handleTraceLogContributed(
    event: LogContributedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    return TraceAnalyticsFoldProjection.applyLogContribution({
      state,
      runtime: this.runtime,
      contribution: {
        traceId: event.data.traceId,
        liftedAttributes: event.data.liftedAttributes,
        nonBillable: event.data.nonBillable,
      },
    });
  }

  handleTraceMetricDataPointCorrelated(
    event: MetricDataPointCorrelatedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    let timeToFirstTokenMs = state.timeToFirstTokenMs;
    if (
      event.data.metricName === "gen_ai.server.time_to_first_token" &&
      event.data.exemplarValue !== null
    ) {
      const ttftMs = event.data.exemplarValue * 1000;
      timeToFirstTokenMs =
        timeToFirstTokenMs === null ? ttftMs : Math.min(timeToFirstTokenMs, ttftMs);
    }

    // Counts exemplar correlations, not metric data points: the canonical
    // datapoint stream is a separate pipeline this fold never sees, so it
    // cannot know how many points a trace's metrics produced.
    const mergedAttributes = { ...state.attributes };
    const correlationCount = parseInt(
      mergedAttributes[METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE] ?? "0",
      10,
    );
    mergedAttributes[METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE] = String(correlationCount + 1);

    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      timeToFirstTokenMs,
      attributes: mergedAttributes,
    };
  }

  handleTraceOriginResolved(
    event: OriginResolvedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    const currentOrigin = state.attributes["langwatch.origin"];
    if (currentOrigin) {
      // Explicit origin already set -- do not override.
      return state;
    }
    return {
      ...state,
      attributes: {
        ...state.attributes,
        "langwatch.origin": event.data.origin,
      },
    };
  }

  handleTraceAnnotationAdded(
    event: AnnotationAddedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    const ids = state.annotationIds ?? [];
    if (ids.includes(event.data.annotationId)) return state;
    return { ...state, annotationIds: [...ids, event.data.annotationId] };
  }

  handleTraceAnnotationRemoved(
    event: AnnotationRemovedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    const ids = state.annotationIds ?? [];
    return {
      ...state,
      annotationIds: ids.filter((id) => id !== event.data.annotationId),
    };
  }

  handleTraceAnnotationsBulkSynced(
    event: AnnotationsBulkSyncedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    const merged = [...new Set([...(state.annotationIds ?? []), ...event.data.annotationIds])];
    return { ...state, annotationIds: merged };
  }

  handleTraceTraceNameChanged(
    event: TraceNameChangedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      traceName: event.data.newName,
      traceNameUserOverridden: true,
      traceNameFromFallback: false,
    };
  }

  private static readNullableString(value: string | undefined): string | null {
    if (typeof value !== "string" || value.length === 0) return null;
    return value;
  }

  /**
   * Reserved-key cache/reasoning token sums are stamped by the fold via
   * `addReservedTokenSum` — always integer-shaped strings, but defensive
   * parsing keeps the slim row stable against bad upstream data.
   */
  private static readReservedTokenSum(value: string | undefined): number | null {
    if (typeof value !== "string" || value.length === 0) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.trunc(parsed);
  }

  /**
   * Labels are stored on the attribute map as JSON string array; parse back
   * for the `Array(String)` column. Defensive: any malformed input → [].
   */
  private static parseLabels(raw: string | undefined): string[] {
    if (typeof raw !== "string" || raw.length === 0) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v): v is string => typeof v === "string");
    } catch {
      return [];
    }
  }

  /**
   * A throwaway `TraceSummaryData`-shaped view over the slim state, for the
   * shared services typed against it. Missing fields get neutral defaults;
   * never persisted.
   */
  private static asTraceSummaryStateView(state: TraceAnalyticsData): TraceSummaryData {
    return {
      traceId: state.traceId,
      spanCount: state.spanCount,
      totalDurationMs: state.totalDurationMs,
      computedIOSchemaVersion: "",
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: state.timeToFirstTokenMs,
      timeToLastTokenMs: null,
      tokensPerSecond: state.tokensPerSecond,
      containsErrorStatus: state.containsErrorStatus,
      containsOKStatus: false,
      errorMessage: null,
      models: state.models,
      totalCost: state.totalCost,
      nonBilledCost: state.nonBilledCost,
      tokensEstimated: false,
      totalPromptTokenCount: state.totalPromptTokenCount,
      totalCompletionTokenCount: state.totalCompletionTokenCount,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      topicId: state.topicId,
      subTopicId: state.subTopicId,
      annotationIds: state.annotationIds,
      attributes: state.attributes,
      traceName: state.traceName,
      rootSpanStartTimeMs: state.rootSpanStartTimeMs,
      traceNameUserOverridden: state.traceNameUserOverridden,
      traceNameFromFallback: state.traceNameFromFallback,
      rootMetadataFromFallback: state.rootMetadataFromFallback,
      occurredAt: state.occurredAt,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      LastEventOccurredAt: state.LastEventOccurredAt,
    };
  }

  /**
   * Roll this span's cache/reasoning token counts into the trace-level
   * running sums on reserved attribute keys. A `skip_token_accumulation`
   * span contributes nothing, same gate as prompt/completion tokens.
   */
  private static accumulateReservedTokenSums(
    attributes: Record<string, string>,
    span: NormalizedSpan,
    runtime: TraceProjectionRuntimeService,
  ): void {
    const cacheTokens = runtime.spanCost.isTokenAccumulationSkipped(span)
      ? { cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 }
      : runtime.spanCost.extractCacheTokens(span);

    TraceSummaryFoldProjection.addReservedTokenSum(
      attributes,
      RESERVED_CACHE_READ_TOKENS,
      cacheTokens.cacheReadTokens,
    );
    TraceSummaryFoldProjection.addReservedTokenSum(
      attributes,
      RESERVED_CACHE_CREATION_TOKENS,
      cacheTokens.cacheCreationTokens,
    );
    TraceSummaryFoldProjection.addReservedTokenSum(
      attributes,
      RESERVED_REASONING_TOKENS,
      cacheTokens.reasoningTokens,
    );
  }

  /**
   * Fold one log contribution: bump reserved log count, merge/mirror
   * attributes. Reads `contribution.liftedAttributes`, NOT mergedAttributes,
   * so cost doesn't double-count across replays.
   */
  private static applyLogContribution({
    state,
    contribution,
    runtime,
  }: {
    state: TraceAnalyticsData;
    contribution: LogContribution;
    runtime: TraceProjectionRuntimeService;
  }): TraceAnalyticsData {
    const mergedAttributes = { ...state.attributes };
    const logCount = parseInt(mergedAttributes["langwatch.reserved.log_record_count"] ?? "0", 10);
    mergedAttributes["langwatch.reserved.log_record_count"] = String(logCount + 1);
    for (const [key, value] of Object.entries(contribution.liftedAttributes)) {
      mergedAttributes[key] = String(value);
    }

    let models = state.models;
    let totalCost = state.totalCost;
    let nonBilledCost = state.nonBilledCost;
    let totalPromptTokenCount = state.totalPromptTokenCount;
    let totalCompletionTokenCount = state.totalCompletionTokenCount;
    const model = contribution.liftedAttributes["langwatch.model"];
    if (typeof model === "string" && model.length > 0) {
      models = TraceSummaryFoldProjection.mergeModelsMostRecentFirst(models, [model]);
    }
    const cost = Number(contribution.liftedAttributes["langwatch.cost.usd"]);
    if (Number.isFinite(cost) && cost > 0) {
      totalCost = (totalCost ?? 0) + cost;
      if (contribution.nonBillable) {
        nonBilledCost = (nonBilledCost ?? 0) + cost;
      }
    }
    const inputTokens = Number(contribution.liftedAttributes["langwatch.input_tokens"]);
    if (Number.isFinite(inputTokens) && inputTokens > 0) {
      totalPromptTokenCount = (totalPromptTokenCount ?? 0) + inputTokens;
    }
    const outputTokens = Number(contribution.liftedAttributes["langwatch.output_tokens"]);
    if (Number.isFinite(outputTokens) && outputTokens > 0) {
      totalCompletionTokenCount = (totalCompletionTokenCount ?? 0) + outputTokens;
    }

    // Same trace-level model metadata stamp the span path applies, so
    // log-only (Path B) traces also surface `metadata.model`.
    runtime.traceAttributes.stampModelMetadata({
      attributes: mergedAttributes,
      models,
    });

    return {
      ...state,
      traceId: state.traceId || contribution.traceId,
      // `occurredAt` is NOT set here, and must not be: it is the span timing
      // baseline, span-seeded only.
      //
      // `SpanTimingService.accumulateTiming` reads `occurredAt > 0` as its "a span
      // has seeded the baseline" sentinel and computes
      // `currentEnd = occurredAt + totalDurationMs`. A log's time is the platform
      // ACCEPT time, not producer business time, so seeding it from here inflates
      // `TotalDurationMs` by the whole ingest lag — and `SpanCostService` divides
      // completion tokens by that value, so `TokensPerSecond` goes with it. It is
      // order-dependent too: the same trace would report two different latencies
      // depending on whether the log or the span folded first. Two tests pin this.
      //
      // Nor can the sentinel move to `spanCount`. A span whose timestamps are
      // unusable still increments the count — `SpanTimingService` early-returns on
      // `!isValidTimestamp(...)` while `applySpanToAnalytics` goes on to
      // `spanCount + 1` — so `spanCount > 0` reads as "timing seeded" when it is
      // not. (Synthetic spans are exempt: `applySpanToAnalytics` returns before
      // the increment, leaving both signals untouched.)
      //
      // What a log record DOES anchor is storage. `storageAnchorMs` is a separate
      // field, frozen by `anchorStorageTime` from `apply` after this handler
      // returns, so a log-only trace gets a real partition and a real TTL deadline
      // without any of the above — ADR-071 step 3, landed.
      attributes: mergedAttributes,
      models,
      totalCost,
      nonBilledCost,
      totalPromptTokenCount,
      totalCompletionTokenCount,
    };
  }

  /**
   * Does this state describe a trace the PRODUCT should count? True on real
   * telemetry, false for dimension-only signal. `storageAnchorMs` is
   * deliberately NOT a door — see {@link TRACE_ANALYTICS_HAS_SIGNAL_SQL}.
   */
  static hasPersistableSignal(state: TraceAnalyticsData): boolean {
    if (state.spanCount > 0) return true;
    if (state.occurredAt > 0) return true;
    const raw = state.attributes?.["langwatch.reserved.log_record_count"];
    return typeof raw === "string" && Number(raw) > 0;
  }

  static projectAnalyticsStateToRow({
    state,
    tenantId,
    version,
    now = Date.now(),
  }: {
    state: TraceAnalyticsData;
    tenantId: string;
    version: string;
    /**
     * Fold time, injected for test determinism. A committed anchor
     * implausibly far ahead is re-anchored on write — see
     * `MAX_ANCHOR_FUTURE_SKEW_MS` in {@link ./services/storage-anchor.ts}.
     */
    now?: number;
  }): TraceAnalyticsRow {
    const attrs = state.attributes ?? {};
    const userId = TraceAnalyticsFoldProjection.readNullableString(
      attrs[TRACE_ANALYTICS_ATTR_KEYS.USER_ID],
    );
    const conversationId = TraceAnalyticsFoldProjection.readNullableString(
      attrs[TRACE_ANALYTICS_ATTR_KEYS.CONVERSATION_ID],
    );
    const customerId = TraceAnalyticsFoldProjection.readNullableString(
      attrs[TRACE_ANALYTICS_ATTR_KEYS.CUSTOMER_ID],
    );
    const origin = attrs[TRACE_ANALYTICS_ATTR_KEYS.ORIGIN] ?? "";
    const labels = TraceAnalyticsFoldProjection.parseLabels(
      attrs[TRACE_ANALYTICS_ATTR_KEYS.LABELS],
    );

    return {
      tenantId,
      traceId: state.traceId,
      version,
      // The anchor, not the timing baseline (ADR-071).
      //
      // The fallback chain is a last resort for a state nothing could anchor: one
      // whose every event carried a zero `occurredAt` (the event schema permits
      // it — `nonnegative`, not `positive`), or whose only candidate times were
      // implausibly far in the future. It exists so the partition column can never
      // be the epoch, and each step is validated rather than trusted —
      // `parseClickHouseDateTimeMs` returns 0 on a parse failure, so an unchecked
      // `state.createdAt` would put the row straight back in 196952, which is the
      // one outcome this whole change exists to prevent.
      //
      // ADR-071 ("One trap for whoever implements it") names `CreatedAt` as a trap
      // for exactly this use, and it is right: it is fold time, so a rebuild
      // re-stamps it. That is accepted here
      // and no worse than the alternative, because it applies ONLY to a state that
      // has no business time at all, and because the read-back promotes whatever
      // landed in the column to the frozen anchor — so it stops drifting after the
      // first write. What the ADR argues for instead (the event log's accept time
      // threaded into the row) is sequencing item 6 and needs the human sign-off
      // recorded there; it is not this change's to take.
      occurredAtMs: firstUsableAnchor({
        candidates: [state.storageAnchorMs, state.createdAt],
        now,
      }),
      earliestSpanStartMs: state.occurredAt,
      createdAtMs: state.createdAt,
      updatedAtMs: state.updatedAt,

      traceName: state.traceName ?? "",
      topicId: state.topicId,
      subTopicId: state.subTopicId,
      userId,
      conversationId,
      customerId,
      origin,
      models: state.models ?? [],
      labels,

      totalCost: state.totalCost,
      nonBilledCost: state.nonBilledCost,
      totalDurationMs: state.totalDurationMs,
      timeToFirstTokenMs: state.timeToFirstTokenMs,
      tokensPerSecond: state.tokensPerSecond,
      promptTokens: state.totalPromptTokenCount,
      completionTokens: state.totalCompletionTokenCount,
      cacheReadTokens: TraceAnalyticsFoldProjection.readReservedTokenSum(
        attrs[RESERVED_CACHE_READ_TOKENS],
      ),
      cacheWriteTokens: TraceAnalyticsFoldProjection.readReservedTokenSum(
        attrs[RESERVED_CACHE_CREATION_TOKENS],
      ),
      reasoningTokens: TraceAnalyticsFoldProjection.readReservedTokenSum(
        attrs[RESERVED_REASONING_TOKENS],
      ),
      hasError: state.containsErrorStatus,
      hasAnnotation: state.annotationIds && state.annotationIds.length > 0 ? true : null,

      attributes: trimAttributesForAnalytics(attrs),

      hasSignal: TraceAnalyticsFoldProjection.hasPersistableSignal(state),

      // Read-back state (ADR-066) — round-trips the fold's working bookkeeping.
      spanCount: state.spanCount,
      annotationIds: state.annotationIds ?? [],
      rootSpanStartTimeMs: state.rootSpanStartTimeMs ?? 0,
      traceNameFromFallback: state.traceNameFromFallback ?? false,
      rootMetadataFromFallback: state.rootMetadataFromFallback ?? false,
      traceNameUserOverridden: state.traceNameUserOverridden ?? false,
      lastEventOccurredAt: state.LastEventOccurredAt,
    };
  }

  /**
   * Decode the fold state from its persisted row (ADR-066), inverse of
   * {@link projectAnalyticsStateToRow}. A deserialize, not a rebuild —
   * version-AWARE for one field, see {@link TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}.
   */
  static traceAnalyticsStateFromRow(row: TraceAnalyticsRow): TraceAnalyticsData {
    // Start from the trimmed map the row carries — it holds the reserved
    // accumulators (cache/reasoning sums, log_record_count, correlation count)
    // verbatim — then re-inject the hoisted dimension keys from their columns so
    // a dimension a long value trimmed out of the map is still present and
    // faithful for the fold's next read.
    const attributes: Record<string, string> = { ...row.attributes };
    if (row.userId) attributes[TRACE_ANALYTICS_ATTR_KEYS.USER_ID] = row.userId;
    if (row.conversationId)
      attributes[TRACE_ANALYTICS_ATTR_KEYS.CONVERSATION_ID] = row.conversationId;
    if (row.customerId) attributes[TRACE_ANALYTICS_ATTR_KEYS.CUSTOMER_ID] = row.customerId;
    if (row.origin) attributes[TRACE_ANALYTICS_ATTR_KEYS.ORIGIN] = row.origin;
    if (row.labels.length > 0)
      attributes[TRACE_ANALYTICS_ATTR_KEYS.LABELS] = JSON.stringify(row.labels);

    return {
      traceId: row.traceId,
      spanCount: row.spanCount,

      topicId: row.topicId,
      subTopicId: row.subTopicId,
      traceName: row.traceName,
      models: row.models,

      // The anchor comes back frozen: whatever the column holds is what the row
      // was partitioned and TTL'd on, so re-deriving it would be free to move it.
      storageAnchorMs: row.occurredAtMs,
      // …and the timing baseline comes back from its OWN column, never from the
      // anchor. Reading it off `occurredAtMs` would hand `SpanTimingService` a
      // log-shaped time as a span start and inflate the trace's duration — and
      // for a log-only trace it would fabricate a span that never arrived.
      //
      // The one exception is a PRE-SPLIT row, where the two were the same column
      // and `OccurredAt` is the `min(span start)` this field wants. Taking it
      // there is what lets the population heal without a refold; taking it
      // anywhere else is the inflation bug above
      // ({@link TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}).
      occurredAt:
        row.version === TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT
          ? row.occurredAtMs
          : row.earliestSpanStartMs,
      totalDurationMs: row.totalDurationMs,
      totalCost: row.totalCost,
      nonBilledCost: row.nonBilledCost,
      totalPromptTokenCount: row.promptTokens,
      totalCompletionTokenCount: row.completionTokens,
      timeToFirstTokenMs: row.timeToFirstTokenMs,
      tokensPerSecond: row.tokensPerSecond,
      containsErrorStatus: row.hasError,

      // The id set behind the row's HasAnnotation boolean; a later add/remove
      // re-derives the boolean from it. Only rows at a DECODABLE stamp reach here,
      // and every decodable stamp postdates migration 00056, so the set is the
      // real one, never a column default. Adding a stamp to
      // DECODABLE_PROJECTION_VERSIONS that predates 00056 would break that.
      annotationIds: row.annotationIds,
      attributes,

      // Name-resolution bookkeeping — 0 root time reads back as "no root yet".
      rootSpanStartTimeMs: row.rootSpanStartTimeMs > 0 ? row.rootSpanStartTimeMs : undefined,
      traceNameUserOverridden: row.traceNameUserOverridden,
      traceNameFromFallback: row.traceNameFromFallback,
      rootMetadataFromFallback: row.rootMetadataFromFallback,

      createdAt: row.createdAtMs,
      updatedAt: row.updatedAtMs,
      LastEventOccurredAt: row.lastEventOccurredAt,
    };
  }

  /**
   * Apply a normalized span to slim state — mirrors `applySpanToSummary` but
   * skips IO/prompt accumulation and heavy bookkeeping.
   * @internal Exported for unit testing.
   */
  static applySpanToAnalytics({
    state,
    span,
    runtime,
  }: {
    state: TraceAnalyticsData;
    span: NormalizedSpan;
    runtime: TraceProjectionRuntimeService;
  }): TraceAnalyticsData {
    if (SYNTHETIC_TRACE_SPAN_NAMES.has(span.name)) {
      // Synthetic spans (e.g. `langwatch.track_event`) must not contribute to
      // timing/cost/IO. The trace-summary fold short-circuits here for the
      // same reason; slim mirrors that contract.
      return state;
    }

    const view = TraceAnalyticsFoldProjection.asTraceSummaryStateView(state);

    const timing = runtime.spanTiming.accumulateTiming({ state: view, span });
    const tokens = runtime.spanCost.accumulateTokens({
      state: view,
      span,
      totalDurationMs: timing.totalDurationMs,
    });
    const status = runtime.spanStatus.accumulateStatus({ state: view, span });

    // Slim does not run TraceIOAccumulationService — but
    // `TraceAttributeAccumulationService.accumulateAttributes` requires the IO
    // bookkeeping fields as arguments. Feed it the neutral "no IO extracted"
    // values: the same shape the IO service returns when nothing was
    // discovered, so the reserved output_source / *_is_fallback keys land on
    // the attribute map identically to a trace with no IO-bearing span.
    const attributes = runtime.traceAttributes.accumulateAttributes({
      state: view,
      span,
      outputSource: OUTPUT_SOURCE.INFERRED,
      inputIsFallback: false,
      outputIsFallback: false,
      inputMediaRefs: null,
      outputMediaRefs: null,
    });

    TraceAnalyticsFoldProjection.accumulateReservedTokenSums(attributes, span, runtime);

    const newModels = runtime.spanCost.extractModelsFromSpan(span);
    const models = TraceSummaryFoldProjection.mergeModelsMostRecentFirst(state.models, newModels);

    // Mirror the trace-summary fold's trace-level model metadata stamp so the
    // slim table's Attributes stay consistent with trace_summaries.
    runtime.traceAttributes.stampModelMetadata({ attributes, models });

    const { traceName, rootSpanStartTimeMs, traceNameFromFallback, rootMetadataFromFallback } =
      runtime.traceName.resolveFromSpan({ state: view, span });

    return {
      ...state,
      traceId: state.traceId || span.traceId,
      spanCount: state.spanCount + 1,
      occurredAt: timing.occurredAt,
      totalDurationMs: timing.totalDurationMs,
      models,
      traceName,
      traceNameFromFallback,
      rootMetadataFromFallback,
      rootSpanStartTimeMs,
      totalCost: tokens.totalCost,
      nonBilledCost: tokens.nonBilledCost,
      totalPromptTokenCount: tokens.totalPromptTokenCount,
      totalCompletionTokenCount: tokens.totalCompletionTokenCount,
      timeToFirstTokenMs: tokens.timeToFirstTokenMs,
      tokensPerSecond: tokens.tokensPerSecond,
      containsErrorStatus: status.containsErrorStatus,
      attributes,
    };
  }
}
