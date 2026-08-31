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
import { trimAttributesForAnalytics } from "../services/analytics-attribute-trim.rules";
import { anchorStorageTime, firstUsableAnchor } from "../services/trace-storage-anchor.rules";
import {
  MAX_PROCESSED_SPANS,
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
  RESERVED_REASONING_TOKENS,
  TraceSummaryFoldProjection,
} from "./trace-summary.projection";

/**
 * Deterministic fold for the slim `trace_analytics` table.
 *
 * It preserves the Trace aggregate's hoisted dimensions while trimming payload
 * attributes. `storageAnchorMs` is frozen because it is the row's partition,
 * sort and TTL address; its timing baseline stays separate.
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

/** Schema-snapshot version (calendar date). Bump when the slim fold's
 *  derivation rules or trim service contract change so older versions can
 *  be replaced via re-fold.
 *
 *  2026-07-27 — the read-back columns of migration 00056 (span count,
 *  annotation ids, the four name-resolution fields, the checkpoint) joined the
 *  projected row shape. That shape change is exactly what this stamp records
 *  (ADR-021/022), and the store's read-back path uses it as the discriminator:
 *  a row carrying an OLDER version predates those columns, so its defaults
 *  cannot be told apart from real zeroes and it is treated as a store miss
 *  (see `TraceAnalyticsStore.getWithApplied`).
 *
 *  2026-07-29 — the storage anchor split (ADR-071 step 3, migration 00061).
 *  BOTH halves of what this stamp records changed at once: the DERIVATION
 *  (`OccurredAt` is now the frozen first-observed business time rather than the
 *  running min of span starts) and the ROW SHAPE (`EarliestSpanStartMs` carries
 *  the span timing baseline that `OccurredAt` used to double as).
 *
 *  This one is NOT a refold trigger, and that distinction is the whole point —
 *  see {@link TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}. */
export const TRACE_ANALYTICS_PROJECTION_VERSION_LATEST = "2026-07-29" as const;

/**
 * The stamp immediately before the storage-anchor split — DECODED, not refused.
 *
 * A `2026-07-27` row has no `EarliestSpanStartMs`, so the obvious move is to
 * treat it the way the 00056 rows were treated: report a store miss and let
 * `refoldOnStoreMiss` rebuild it. That would be wrong here, and expensively so.
 * Rejecting every existing row forces the WHOLE population to rebuild from
 * `event_log` on its next delivery, and a rebuild RE-DERIVES the anchor from
 * replayed history — so a change whose entire premise is "a storage anchor is
 * written once" would open by re-anchoring every trace it touches. For a trace
 * whose spans arrived out of order the rebuilt anchor differs from the
 * `min(span start)` the column held — in either direction, since the first event
 * a replay reaches may be a log or a topic assignment whose time precedes the
 * first span — so the row changes sort key, orphans its
 * previous version until TTL, and can cross a `toYearWeek` boundary — ADR-071
 * consequences 1-3, reintroduced at population scale by the fix for them.
 *
 * It is also unnecessary, because a pre-split row is NOT ambiguous. On it,
 * `OccurredAt` is `min(span start)`, which is simultaneously:
 *
 *   - a VALID ANCHOR — it is the value the row was actually partitioned, sorted
 *     and TTL'd on, so adopting it moves nothing; and
 *   - the CORRECT BASELINE — it is exactly what `EarliestSpanStartMs` was split
 *     out to carry.
 *
 * So the transitional decode reads both fields off that one column and the row
 * heals in place: no refold, no re-anchoring, no backfill. A log-only pre-split
 * row carries 0, which is the right answer twice over — no span has been folded,
 * and an unusable anchor lets the next contribution freeze a real one, which is
 * the 196952 escape this change exists to perform.
 *
 * Why the stamp still had to move: once BOTH shapes exist,
 * `EarliestSpanStartMs = 0` means either "pre-split row, baseline lives in
 * OccurredAt" or "post-split log-only trace, baseline genuinely 0 and OccurredAt
 * is a LOG time". Reading the second as the first hands `SpanTimingService` a log
 * time as a span start and inflates the trace's duration by the whole ingest lag.
 * The version is what tells them apart.
 */
export const TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT = "2026-07-27" as const;

/**
 * How far a trace's OccurredAt (the partition column, and since ADR-071 step 3
 * the frozen storage anchor) may sit from the business time a read is anchored
 * on. Spans/logs/metrics land within the trace's active window
 * (seconds-minutes), but a late annotation or topic assignment can arrive days
 * later, so the read-back window is ±7 days. Declared once, on the fold;
 * the executor derives `context.readWindow` from it and retries a windowed miss
 * unwindowed, so a signal outside the window is still found.
 */
export const TRACE_ANALYTICS_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many same-trace events one load/apply/store cycle may coalesce.
 *
 * Lower than the platform default (500) because this fold persists the
 * applied-event-id watermark INTO its ClickHouse row: on a fresh delivery the
 * stored set is exactly the batch's ids, so the coalesce ceiling IS the per-row
 * watermark size. `trace_analytics` is a ReplacingMergeTree that only collapses
 * rows sharing the full sort key; the frozen anchor (ADR-071 step 3) keeps a
 * trace's versions on one key, but the pre-freeze rows whose OccurredAt moved
 * with each late earlier-starting span still carry a version — and its own
 * watermark — per distinct value, surviving until TTL. 128 ids is a few KB per
 * version instead of ~15-20 KB, and still drains a backed-up hot trace in
 * 128-event bites: the O(n²) → O(n) collapse comes from coalescing at all, not
 * from the size of the ceiling.
 *
 * Must stay below MAX_APPLIED_EVENT_IDS (the Redis cache trims the set at that
 * cap; a batch at or above it would break redelivery dedup — the projection
 * router rejects such a config at registration).
 */
export const TRACE_ANALYTICS_COALESCE_MAX_BATCH = 128;

/**
 * The slim row that lands in `trace_analytics`. Field names align with the
 * ClickHouse column names (PascalCase mirrored on the camelCase record so the
 * repository's record literal is a 1:1 column mapping).
 *
 * Heavy artifacts intentionally absent (compared to TraceSummaryFieldsBase):
 *   - ComputedInput / ComputedOutput
 *   - ErrorMessage
 *   - AnnotationIds[] (collapsed to HasAnnotation Bool)
 *   - TimeToLastTokenMs, SpanCount (not analytics dimensions)
 *   - SelectedPrompt* / LastUsedPrompt* (prompt rollup is detail)
 *   - ContainsAi / ContainsOKStatus / TokensEstimated / OutputFromRootSpan
 *     / OutputSpanEndTimeMs / BlockedByGuardrail / RootSpanType
 *   - Events.*, Links.*, InstrumentationScope, ScopeName, ScopeVersion
 *
 * What's kept: keys, the storage anchor (OccurredAt), hoisted dim columns,
 * metric scalars, HasError + HasAnnotation, and the trimmed Attributes map.
 */
export interface TraceAnalyticsRow {
  tenantId: string;
  traceId: string;
  /** Schema-snapshot version (NOT the LWW dedup key — that is UpdatedAt,
   *  same as trace_summaries; migration 00039). */
  version: string;
  /**
   * The trace's STORAGE ANCHOR → the `OccurredAt` column: partition key, lead
   * sort key and TTL anchor all at once (migration 00039).
   *
   * Since ADR-071 step 3 this is `state.storageAnchorMs` — the first business
   * time the fold observed for the trace, frozen — NOT the running minimum of
   * span start times it used to be. The min lives on `earliestSpanStartMs`.
   * The field keeps its column-shaped name so the repository's record literal
   * stays a 1:1 column mapping; its MEANING is the anchor.
   */
  occurredAtMs: number;
  /**
   * The span timing baseline → the `EarliestSpanStartMs` column (migration
   * 00061): the earliest start time across the trace's non-synthetic spans, or
   * 0 while no span has been folded. `TotalDurationMs` is measured from it.
   *
   * It has its own column because `OccurredAt` no longer carries it, and
   * without one the read-back would decode "no span yet" onto a trace that has
   * spans — restarting its duration from the next span alone.
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
   * The persistable-signal verdict. NOT a table column — the row already
   * carries every operand (`SpanCount`, `EarliestSpanStartMs`, the reserved
   * log-record-count attribute), so readers derive the verdict in SQL via
   * {@link TRACE_ANALYTICS_HAS_SIGNAL_SQL}; this field rides the in-memory
   * row so the write path and tests can speak it directly, and the repository
   * re-derives it on read-back.
   *
   * The store used to enforce this by NOT WRITING the row, which kept phantom
   * traces out of analytics but made a missing row ambiguous — "new aggregate"
   * and "declined to persist" were indistinguishable, so the executor answered
   * every store miss with an unwindowed fallback scan plus a re-fold from
   * `event_log` (measured: 150,573 fallback scans in 30 days, zero of which
   * found anything). Now the row is always written and analytics readers
   * filter the derived verdict, seeing the same population as before; the
   * fold read-back ignores it, so absence is authoritative.
   *
   * Monotonic non-decreasing: `spanCount` only grows and `occurredAt` latches,
   * so once a trace has signal every later version has it too. Readers may
   * therefore filter on the LATEST version's flag alone.
   */
  hasSignal: boolean;

  // ── Read-back state (ADR-066, migration 00056) ─────────────────────────
  // Not analytics columns — these round-trip the fold's working state so
  // store.get() can decode the row without replaying event_log. The hoisted
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
 * Canonical reserved-attribute keys we read off the accumulated attribute map.
 * Centralised so the fold + the unit tests + future readers point at the same
 * source of truth. These match the `dest` values in
 * trace-attribute-accumulation.service.ts:62-87 / line 167.
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
 * In-memory accumulator for the slim fold. Carries ONLY the fields slim's
 * handlers + the projection function read/write. Intentionally drops the
 * heavy fields the trace-summary fold maintains.
 *
 * Includes a handful of timing/name-resolution bookkeeping fields that the
 * shared services need on the state shape they read from
 * (`rootSpanStartTimeMs`, `traceNameUserOverridden`,
 * `traceNameFromFallback`, `rootMetadataFromFallback`). They are internal —
 * they never reach a column on `trace_analytics`.
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
   * The trace's STORAGE ANCHOR, epoch ms (0 = nothing observed yet).
   *
   * Written to the `OccurredAt` column, which is the partition key, the lead
   * sort key AND the TTL anchor. Seeded by the FIRST contribution that carries
   * a usable business time — a span, a log record, a metric correlation, an
   * annotation, a topic assignment, an origin resolution, a rename — and never
   * moved afterwards (ADR-071: a storage anchor is written once).
   *
   * Deliberately separate from `occurredAt` below. That one is span-seeded and
   * is the timing baseline; only spans may touch it, because `SpanTimingService`
   * reads `occurredAt > 0` as "a span has seeded the baseline" and measures
   * `TotalDurationMs` from it. Anchoring the two on one field is what put
   * log-only traces (Claude Code / Codex "Path B") in partition 196952 with a
   * TTL deadline of `1970 + retention`, already past, so they were reaped on the
   * next TTL merge and every later delivery refolded the whole aggregate.
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
 * The storage-anchor rule itself lives in
 * {@link ./services/storage-anchor.ts} - `MAX_ANCHOR_FUTURE_SKEW_MS`,
 * `isUsableAnchorMs`, `firstUsableAnchor` and `anchorStorageTime` - because
 * `traceSummary` applies the same rule (migration 00072, ADR-087) and a second
 * copy of it would drift.
 */

/**
 * Project the in-memory slim state into the slim `TraceAnalyticsRow`. Pure: no
 * I/O, and no external state beyond the injectable `now` below, which a caller
 * may pin.
 *
 * Used by the projection's store adapter to derive the persisted record.
 */
/**
 * {@link hasPersistableSignal}, as a SQL predicate over the columns the row
 * already carries — which is what lets the always-write change ship with NO
 * schema migration. The doors map 1:1 onto the in-memory predicate:
 * `SpanCount` is `state.spanCount`, `EarliestSpanStartMs` is
 * `state.occurredAt` (that column carries it since the 00061 anchor split),
 * and the reserved log-record-count attribute survives
 * `trimAttributesForAnalytics` by its `langwatch.reserved.` prefix — the
 * ADR-066 read-back already depends on that, so the dependency is not new.
 *
 * The fourth door has no in-memory twin: rows stamped BEFORE the pre-split
 * version predate the 00056 read-back columns, so their `SpanCount` /
 * `EarliestSpanStartMs` decode as default 0 even though every one of them
 * passed the write-gate (nothing else was ever written back then). Version
 * stamps are ISO dates, so a lexicographic compare orders them correctly;
 * without this door those real traces would vanish from analytics.
 *
 * Every reader that treats a row on this table as "a trace" must apply this —
 * today that is one place, `dedupedSlim` in slim-timeseries-query.ts. The
 * fold read-back must NOT.
 */
export const TRACE_ANALYTICS_HAS_SIGNAL_SQL =
  `(SpanCount > 0` +
  ` OR EarliestSpanStartMs > 0` +
  ` OR Attributes['langwatch.reserved.log_record_count'] NOT IN ('', '0')` +
  ` OR Version < '${TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}')`;

// ─── Service composition ────────────────────────────────────────────

/**
 * A single log record's normalized contribution to the slim analytics
 * fold: `log_record_received` builds it from the raw record (canonical
 * lift + resource-level non-billable flag), `log_contributed` carries
 * the already-lifted fields on the event itself.
 */
interface LogContribution {
  traceId: string;
  liftedAttributes: Record<string, unknown>;
  nonBillable: boolean;
}

// ─── Fold projection class ──────────────────────────────────────────

/**
 * Slim fold projection.
 *
 * Handlers call the same service CLASSES the trace-summary fold uses
 * (SpanCostService, SpanTimingService, …), so when a service's logic
 * changes both folds pick up the change automatically. Slim's role is
 * orchestration: assemble service inputs from the lean state, apply only
 * the slim-relevant outputs back. The persisted shape is `TraceAnalyticsRow`
 * — projected from `TraceAnalyticsData` at write time by the store.
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
   * Rows round-trip current fold state and the delivery watermark. Older shapes
   * re-fold once; the pre-storage-anchor shape is decoded to avoid re-anchoring
   * the population. Out-of-order batches fold in place because the derived
   * values commute, while the frozen storage anchor remains a storage address.
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
   * Dispatch as the base class does, then freeze the storage anchor if this is
   * the first contribution that carried a usable business time (ADR-071 step 3,
   * {@link anchorStorageTime}).
   *
   * Here rather than in the ten handlers because the anchor's rule is about
   * CONTRIBUTIONS, not about spans: a trace whose only signal is a log record,
   * a metric correlation or a topic assignment must still get a real partition
   * and a real TTL deadline. One seam also means a new event type cannot
   * silently arrive un-anchored — the way `state.occurredAt` left every
   * non-span contribution anchored at the epoch.
   *
   * After `super.apply`, so a span's own start time (which the handler has by
   * then put on `state.occurredAt`) is preferred over the envelope's ingest
   * stamp, and so an unhandled event type — which `super.apply` returns
   * untouched — anchors nothing.
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
   * Labels are stored on the trace attribute map as a JSON-serialised string
   * array (see TraceAttributeAccumulationService.accumulateAttributes, lines
   * 214-224). Slim's Labels column is `Array(String)`, so parse the JSON back
   * into an array. Defensive: bad JSON → empty array; non-array JSON → empty
   * array; non-string elements skipped.
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
   * Build a `TraceSummaryData`-shaped view over the slim state for the shared
   * services that type their `state` argument as TraceSummaryData. Slim only
   * carries a subset of those fields; the rest are filled with default values
   * that the services either don't read (the common case) or read as a
   * neutral "nothing yet" — keeping service behaviour identical to a fresh
   * trace-summary state on the dropped fields.
   *
   * The view is throwaway: services consume it, slim takes the fields it
   * cares about out of the result, and the view itself is never persisted.
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

  /** Add a positive per-span delta onto a reserved running-sum attribute. */
  private static addReservedTokenSum(
    attributes: Record<string, string>,
    key: string,
    delta: number,
  ): void {
    if (delta <= 0) return;
    const prior = Number(attributes[key] ?? "0");
    attributes[key] = String((Number.isFinite(prior) ? prior : 0) + delta);
  }

  /**
   * Roll this span's cache / reasoning token counts into the trace-level running
   * sums stored on reserved attribute keys (the drawer popover and slim's
   * `cache*` columns both read them).
   *
   * A span flagged `skip_token_accumulation` is a redundant copy of another
   * span's usage, so it contributes nothing — the same gate
   * `SpanCostService.accumulateTokens` applies to prompt/completion tokens, and
   * the same one `traceSummary.foldProjection` applies here. Mutates
   * `attributes` in place, mirroring the trace-summary fold's bookkeeping.
   */
  private static accumulateReservedTokenSums(
    attributes: Record<string, string>,
    span: NormalizedSpan,
    runtime: TraceProjectionRuntimeService,
  ): void {
    const cacheTokens = runtime.spanCost.isTokenAccumulationSkipped(span)
      ? { cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 }
      : runtime.spanCost.extractCacheTokens(span);

    TraceAnalyticsFoldProjection.addReservedTokenSum(
      attributes,
      RESERVED_CACHE_READ_TOKENS,
      cacheTokens.cacheReadTokens,
    );
    TraceAnalyticsFoldProjection.addReservedTokenSum(
      attributes,
      RESERVED_CACHE_CREATION_TOKENS,
      cacheTokens.cacheCreationTokens,
    );
    TraceAnalyticsFoldProjection.addReservedTokenSum(
      attributes,
      RESERVED_REASONING_TOKENS,
      cacheTokens.reasoningTokens,
    );
  }

  /**
   * Fold one log contribution into slim: bump the reserved log count,
   * merge the lifted canonical langwatch.* attributes, and mirror them
   * onto slim's top-level columns. Each api_request event is its OWN
   * turn — cost + tokens are additive across turns, models are deduped.
   * Read from contribution.liftedAttributes (this event's contribution)
   * NOT mergedAttributes, so cost doesn't double-count across replays.
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
   * Does this state describe a trace the PRODUCT should count? True on any real
   * telemetry: a folded span, a surviving business time (`occurredAt > 0` — only
   * a folded span ever sets it, never a phantom init state), or a log record
   * (Claude Code Path B, Codex Path B — the trace-summary fold counts these via
   * langwatch.reserved.log_record_count and this mirrors its acceptance).
   *
   * A state carrying ONLY dimension signal (topic / annotation / name) answers
   * false. That answer used to mean the row was NOT WRITTEN; now it is always
   * written and analytics readers exclude it via
   * {@link TRACE_ANALYTICS_HAS_SIGNAL_SQL} while the fold read-back still finds
   * it. `storageAnchorMs` is deliberately NOT a door: a row on this table is a
   * TRACE to every analytics read, so admitting a state whose sole signal is an
   * annotation or a classification would change what the product means by "a
   * trace" — the derived filter carries that refusal now, instead of the row's
   * absence.
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
     * Fold time, injected so the function stays deterministic under test.
     *
     * Read by the anchor's VALIDATION as well as its last-resort fallback: every
     * candidate is bounded against it, so a state whose committed anchor is
     * implausibly far ahead of `now` is re-anchored on write rather than carried
     * through. That is the one case where an already-committed row changes
     * partition, and it is deliberate — see `MAX_ANCHOR_FUTURE_SKEW_MS` in
     * {@link ./services/storage-anchor.ts}.
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
   * Decode the fold's working state from its persisted `trace_analytics` row —
   * the `fromRow` inverse of {@link projectAnalyticsStateToRow} (ADR-066).
   *
   * This is a deserialize, NOT a rebuild. A rebuild replays the trace's spans /
   * logs / annotations from `event_log`; this only maps the columns of the last
   * committed slim row back into the fold's state shape, so `store.get()` can
   * return the state that Redis (or, on a miss, ClickHouse) already holds. It
   * derives nothing.
   *
   * The slim row is deliberately lossy on ONE axis — the Attributes map is
   * trimmed at write time. That is not a read-back gap, but only because the trim
   * is written to keep everything the fold reads back: the hoisted dimension keys
   * and the accumulators it grows by read-modify-write. The dimension keys are
   * re-injected here from their typed columns (UserId / ConversationId /
   * CustomerId / Origin / Labels), so they are faithful even when a long value
   * was trimmed out of the map. The accumulators survive by contract — every
   * `langwatch.reserved.*` key plus the named exceptions in the trim service's
   * FOLD_ACCUMULATOR_KEYS, which exists precisely because `langwatch.prompt_ids`
   * accumulates without carrying the reserved prefix. Payload / over-cap keys the
   * trim drops are never read by the fold, so their absence derives nothing.
   *
   * The coupling is real and worth stating plainly: a key that the fold reads its
   * own previous value from, and that the trim can drop, resets the accumulator
   * on the next read-back instead of merely shrinking the stored row. Adding such
   * a key means adding it to that set — the fold-equivalence suite fails if not.
   *
   * This decoder is TOTAL: handed a row whose read-back columns are absent it
   * still answers, mapping the ClickHouse column defaults to state defaults
   * (spanCount 0, empty annotation set, no root claimed, checkpoint 0, no span
   * timing baseline). Those defaults are indistinguishable from real zeroes, so
   * deciding WHETHER a row may be decoded is the store's job, not this function's:
   * `getWithApplied` admits the current stamp and the one pre-split stamp it can
   * read unambiguously, reports anything older as a store miss, and the fold's
   * `refoldOnStoreMiss` rebuilds that aggregate from `event_log` once. A caller
   * that bypasses the version gate gets the defaults above.
   *
   * The decoder is version-AWARE for exactly one field pair — see the
   * `occurredAt` branch below and
   * {@link TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}.
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
   * Apply a normalized span to the slim state — calls ONLY the services slim
   * needs (timing, cost/tokens, status, models, name resolution, attributes
   * + reserved cache/reasoning sums), and updates ONLY slim-relevant fields.
   *
   * Mirrors the orchestration in `applySpanToSummary` (trace-summary fold) but
   * skips IO accumulation, prompt accumulation, containsAi tracking, and the
   * heavy bookkeeping (errorMessage, rootSpanType, computedInput/Output,
   * tokensEstimated, blockedByGuardrail, outputFromRootSpan, …).
   *
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
