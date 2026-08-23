import type {
  FoldProjectionOptions,
  FoldProjectionStore,
} from "@langwatch/eventing";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "@langwatch/eventing";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import {
  enrichRagContextIds,
  SpanNormalizationPipelineService,
} from "~/server/app-layer/traces/span-normalization.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { SYNTHETIC_SPAN_NAMES } from "~/server/tracer/constants";
import { METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE } from "../schemas/constants";
import type {
  AnnotationAddedEvent,
  AnnotationRemovedEvent,
  AnnotationsBulkSyncedEvent,
  LogContributedEvent,
  LogRecordReceivedEvent,
  MetricDataPointCorrelatedEvent,
  OriginResolvedEvent,
  SpanReceivedEvent,
  TopicAssignedEvent,
  TraceNameChangedEvent,
} from "../schemas/events";
import {
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  logContributedEventSchema,
  logRecordReceivedEventSchema,
  metricDataPointCorrelatedEventSchema,
  originResolvedEventSchema,
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  traceNameChangedEventSchema,
} from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import {
  liftCanonicalAttributesFromLogRecord,
  NON_BILLABLE_ATTR,
  OUTPUT_SOURCE,
  SpanCostService,
  SpanStatusService,
  SpanTimingService,
  TraceAttributeAccumulationService,
  TraceNameResolutionService,
  TraceOriginService,
} from "./services";
import { trimAttributesForAnalytics } from "./services/analytics-attribute-trim.service";
import {
  anchorStorageTime,
  firstUsableAnchor,
} from "./services/storage-anchor";
import {
  MAX_PROCESSED_SPANS,
  mergeModelsMostRecentFirst,
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
  RESERVED_REASONING_TOKENS,
} from "./traceSummary.foldProjection";

/**
 * ADR-034 Phase 2: slim per-trace fold projection.
 *
 * Writes to `trace_analytics` (migration 00039) — a ReplacingMergeTree(Version)
 * keyed on (TenantId, TraceId), partitioned by toYearWeek(OccurredAt), with the
 * sort key reorganised onto time (`(TenantId, OccurredAt, TraceId)`) so
 * analytics scans pull contiguous granules.
 *
 * Two slim invariants are upheld by this projection:
 *
 *   1. **Hoisted dimensions** are surfaced onto typed root-level columns
 *      (TopicId / SubTopicId / UserId / ConversationId / CustomerId / Origin /
 *      Models / Labels / TraceName). The fold pulls them from the same
 *      canonical attribute map the trace-summary fold accumulates, using the
 *      exact reserved keys defined by RESOURCE_ATTR_CANONICAL_MAPPINGS in
 *      trace-attribute-accumulation.service.ts (lines 62-87) and the
 *      TraceOriginService for langwatch.origin.
 *
 *   2. **Attributes map is TRIMMED** at write time via
 *      `trimAttributesForAnalytics` — metadata.* values capped at 4 KiB,
 *      langwatch.reserved.* always kept, arbitrary keys kept iff ≤ 256 chars,
 *      and known-payload keys (`gen_ai.prompt` / `gen_ai.completion` /
 *      `gen_ai.response.choices` / `gen_ai.response.finish_reasons` plus the
 *      input/output/llm.input_messages blocklist) dropped regardless of length.
 *
 * The slim fold's in-memory state (`TraceAnalyticsData`) carries ONLY the
 * fields slim's handlers + the projection function read. Heavy fields the
 * trace-summary fold maintains (ComputedInput/Output, prompt tracking, scenario
 * roles, error message text, root-span type, tokensEstimated, span cost map,
 * containsAi/containsPrompt, …) are intentionally absent — the bytes for
 * those are the whole reason slim exists.
 *
 * To avoid re-implementing service logic, slim's handlers REUSE the same
 * service classes the trace-summary fold uses (SpanCostService,
 * SpanTimingService, SpanStatusService, TraceOriginService,
 * TraceAttributeAccumulationService, TraceNameResolutionService). Those
 * services accept a `TraceSummaryData`-shaped state argument, so we build a
 * thin adapter (`asTraceSummaryStateView`) that fills in the slim values plus
 * zero/default placeholders for the fields the slim state drops — those
 * placeholders feed only the service call and are discarded, never persisted.
 *
 * Storage anchor (ADR-071 step 3): `OccurredAt` is the partition key, the lead
 * sort key AND the TTL anchor, so it is a STORAGE ANCHOR — frozen on the first
 * contribution that carries a usable business time and never moved after
 * (`storageAnchorMs`). It is no longer the running minimum of span starts; that
 * value is the fold's timing baseline and now has its own column
 * (`EarliestSpanStartMs`, migration 00061). Sharing one column between the two
 * jobs is what wrote a log-only trace into partition 196952 with an
 * already-expired TTL deadline.
 *
 * Re-fold safety (ADR-021/022): a re-fold produces the same canonical state,
 * written with a later UpdatedAt — the LWW column readers dedup on. Note the
 * ENGINE only physically collapses rows sharing the full sort key
 * `(TenantId, OccurredAt, TraceId)`. Freezing the anchor is what lets versions
 * of one trace share that key and collapse; rows written BEFORE the freeze, and
 * a trace whose anchor was re-stamped by a rebuild after a store miss, still
 * carry more than one value, so every read MUST dedup by
 * (TenantId, TraceId, max(UpdatedAt)) — the IN-tuple pattern the slim query
 * builders use. No explicit truncate, no settle, no signs.
 *
 * State continuity (ADR-066): the store reads its own last committed row back
 * (`get` → `findByTraceIdWithApplied` → `traceAnalyticsStateFromRow`). The
 * typed read-back columns (migration 00056) close the round-trip gap the
 * trimmed row otherwise left, so the delivery path does not re-fold from the
 * event log. Redis fronts the read; a miss is one windowed ClickHouse row.
 * Read-back applies to rows stamped with the current projection version and to
 * the one pre-split stamp the decoder can read unambiguously; anything older is
 * reported as a miss and refolded once, then rewritten at the current version
 * (see `options` below and {@link TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}).
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
export const TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT =
  "2026-07-27" as const;

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
export function hasPersistableSignal(state: TraceAnalyticsData): boolean {
  if (state.spanCount > 0) return true;
  if (state.occurredAt > 0) return true;
  const raw = state.attributes?.["langwatch.reserved.log_record_count"];
  return typeof raw === "string" && Number(raw) > 0;
}

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

export function projectAnalyticsStateToRow({
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
  const userId = readNullableString(attrs[TRACE_ANALYTICS_ATTR_KEYS.USER_ID]);
  const conversationId = readNullableString(
    attrs[TRACE_ANALYTICS_ATTR_KEYS.CONVERSATION_ID],
  );
  const customerId = readNullableString(
    attrs[TRACE_ANALYTICS_ATTR_KEYS.CUSTOMER_ID],
  );
  const origin = attrs[TRACE_ANALYTICS_ATTR_KEYS.ORIGIN] ?? "";
  const labels = parseLabels(attrs[TRACE_ANALYTICS_ATTR_KEYS.LABELS]);

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
    cacheReadTokens: readReservedTokenSum(attrs[RESERVED_CACHE_READ_TOKENS]),
    cacheWriteTokens: readReservedTokenSum(
      attrs[RESERVED_CACHE_CREATION_TOKENS],
    ),
    reasoningTokens: readReservedTokenSum(attrs[RESERVED_REASONING_TOKENS]),
    hasError: state.containsErrorStatus,
    hasAnnotation:
      state.annotationIds && state.annotationIds.length > 0 ? true : null,

    attributes: trimAttributesForAnalytics(attrs),

    hasSignal: hasPersistableSignal(state),

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
export function traceAnalyticsStateFromRow(
  row: TraceAnalyticsRow,
): TraceAnalyticsData {
  // Start from the trimmed map the row carries — it holds the reserved
  // accumulators (cache/reasoning sums, log_record_count, correlation count)
  // verbatim — then re-inject the hoisted dimension keys from their columns so
  // a dimension a long value trimmed out of the map is still present and
  // faithful for the fold's next read.
  const attributes: Record<string, string> = { ...row.attributes };
  if (row.userId) attributes[TRACE_ANALYTICS_ATTR_KEYS.USER_ID] = row.userId;
  if (row.conversationId)
    attributes[TRACE_ANALYTICS_ATTR_KEYS.CONVERSATION_ID] = row.conversationId;
  if (row.customerId)
    attributes[TRACE_ANALYTICS_ATTR_KEYS.CUSTOMER_ID] = row.customerId;
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
    rootSpanStartTimeMs:
      row.rootSpanStartTimeMs > 0 ? row.rootSpanStartTimeMs : undefined,
    traceNameUserOverridden: row.traceNameUserOverridden,
    traceNameFromFallback: row.traceNameFromFallback,
    rootMetadataFromFallback: row.rootMetadataFromFallback,

    createdAt: row.createdAtMs,
    updatedAt: row.updatedAtMs,
    LastEventOccurredAt: row.lastEventOccurredAt,
  };
}

function readNullableString(value: string | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

/**
 * Reserved-key cache/reasoning token sums are stamped by the fold via
 * `addReservedTokenSum` — always integer-shaped strings, but defensive
 * parsing keeps the slim row stable against bad upstream data.
 */
function readReservedTokenSum(value: string | undefined): number | null {
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
function parseLabels(raw: string | undefined): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

// ─── Service composition ────────────────────────────────────────────

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

const spanTimingService = new SpanTimingService();
const spanStatusService = new SpanStatusService();
const spanCostService = new SpanCostService();
const traceOriginService = new TraceOriginService();
const traceAttributeAccumulationService = new TraceAttributeAccumulationService(
  traceOriginService,
);
const traceNameResolutionService = new TraceNameResolutionService();

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
function asTraceSummaryStateView(state: TraceAnalyticsData): TraceSummaryData {
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
function addReservedTokenSum(
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
function accumulateReservedTokenSums(
  attributes: Record<string, string>,
  span: NormalizedSpan,
): void {
  const cacheTokens = spanCostService.isTokenAccumulationSkipped(span)
    ? { cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 }
    : spanCostService.extractCacheTokens(span);

  addReservedTokenSum(
    attributes,
    RESERVED_CACHE_READ_TOKENS,
    cacheTokens.cacheReadTokens,
  );
  addReservedTokenSum(
    attributes,
    RESERVED_CACHE_CREATION_TOKENS,
    cacheTokens.cacheCreationTokens,
  );
  addReservedTokenSum(
    attributes,
    RESERVED_REASONING_TOKENS,
    cacheTokens.reasoningTokens,
  );
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
export function applySpanToAnalytics({
  state,
  span,
}: {
  state: TraceAnalyticsData;
  span: NormalizedSpan;
}): TraceAnalyticsData {
  if (SYNTHETIC_SPAN_NAMES.has(span.name)) {
    // Synthetic spans (e.g. `langwatch.track_event`) must not contribute to
    // timing/cost/IO. The trace-summary fold short-circuits here for the
    // same reason; slim mirrors that contract.
    return state;
  }

  const view = asTraceSummaryStateView(state);

  const timing = spanTimingService.accumulateTiming({ state: view, span });
  const tokens = spanCostService.accumulateTokens({
    state: view,
    span,
    totalDurationMs: timing.totalDurationMs,
  });
  const status = spanStatusService.accumulateStatus({ state: view, span });

  // Slim does not run TraceIOAccumulationService — but
  // `TraceAttributeAccumulationService.accumulateAttributes` requires the IO
  // bookkeeping fields as arguments. Feed it the neutral "no IO extracted"
  // values: the same shape the IO service returns when nothing was
  // discovered, so the reserved output_source / *_is_fallback keys land on
  // the attribute map identically to a trace with no IO-bearing span.
  const attributes = traceAttributeAccumulationService.accumulateAttributes({
    state: view,
    span,
    outputSource: OUTPUT_SOURCE.INFERRED,
    inputIsFallback: false,
    outputIsFallback: false,
    inputMediaRefs: null,
    outputMediaRefs: null,
  });

  accumulateReservedTokenSums(attributes, span);

  const newModels = spanCostService.extractModelsFromSpan(span);
  const models = mergeModelsMostRecentFirst(state.models, newModels);

  // Mirror the trace-summary fold's trace-level model metadata stamp so the
  // slim table's Attributes stay consistent with trace_summaries.
  traceAttributeAccumulationService.stampModelMetadata({ attributes, models });

  const {
    traceName,
    rootSpanStartTimeMs,
    traceNameFromFallback,
    rootMetadataFromFallback,
  } = traceNameResolutionService.resolveFromSpan({ state: view, span });

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

/**
 * Fold one log contribution into slim: bump the reserved log count,
 * merge the lifted canonical langwatch.* attributes, and mirror them
 * onto slim's top-level columns. Each api_request event is its OWN
 * turn — cost + tokens are additive across turns, models are deduped.
 * Read from contribution.liftedAttributes (this event's contribution)
 * NOT mergedAttributes, so cost doesn't double-count across replays.
 */
function applyLogContribution({
  state,
  contribution,
}: {
  state: TraceAnalyticsData;
  contribution: LogContribution;
}): TraceAnalyticsData {
  const mergedAttributes = { ...state.attributes };
  const logCount = parseInt(
    mergedAttributes["langwatch.reserved.log_record_count"] ?? "0",
    10,
  );
  mergedAttributes["langwatch.reserved.log_record_count"] = String(
    logCount + 1,
  );
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
    models = mergeModelsMostRecentFirst(models, [model]);
  }
  const cost = Number(contribution.liftedAttributes["langwatch.cost.usd"]);
  if (Number.isFinite(cost) && cost > 0) {
    totalCost = (totalCost ?? 0) + cost;
    if (contribution.nonBillable) {
      nonBilledCost = (nonBilledCost ?? 0) + cost;
    }
  }
  const inputTokens = Number(
    contribution.liftedAttributes["langwatch.input_tokens"],
  );
  if (Number.isFinite(inputTokens) && inputTokens > 0) {
    totalPromptTokenCount = (totalPromptTokenCount ?? 0) + inputTokens;
  }
  const outputTokens = Number(
    contribution.liftedAttributes["langwatch.output_tokens"],
  );
  if (Number.isFinite(outputTokens) && outputTokens > 0) {
    totalCompletionTokenCount = (totalCompletionTokenCount ?? 0) + outputTokens;
  }

  // Same trace-level model metadata stamp the span path applies, so
  // log-only (Path B) traces also surface `metadata.model`.
  traceAttributeAccumulationService.stampModelMetadata({
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
  readonly name = "traceAnalytics";
  readonly version = TRACE_ANALYTICS_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<TraceAnalyticsData>;

  protected readonly events = traceAnalyticsEvents;

  /**
   * The store reads its own last committed state back (ADR-066): the row now
   * round-trips the full working state — counters, the annotation id set, the
   * name-resolution bookkeeping, the out-of-order checkpoint — via typed
   * read-back columns (migration 00056), plus the trimmed attribute map with
   * its hoisted dimensions re-injected. So `store.get()` returns the state and
   * nothing on the delivery path reads `event_log`.
   *
   * `refoldOnStoreMiss: true` — a version-gated TRANSITIONAL net, not the old
   * continuity mechanism. The store reads back only rows stamped with the
   * CURRENT projection version; a row written before the 00056 read-back columns
   * existed decodes every one of them as a column default it cannot tell apart
   * from a real zero, so the store reports a miss and this option rebuilds that
   * aggregate from `event_log` — once. The rebuild is rewritten at the current
   * version, so the row hits from then on and the whole population self-heals
   * with no backfill migration. Without the gate a stale row would
   * silently downgrade a user-renamed trace to a late span's name, freeze a
   * fallback-named trace, and reset the MAX_PROCESSED_SPANS cap so already-
   * committed cost/tokens were counted twice.
   *
   * The storage-anchor split (migration 00061) pointedly did NOT join that list
   * — its predecessor stamp is decoded rather than refused, because refusing it
   * would rebuild the whole population and a rebuild re-derives the anchor. See
   * {@link TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}.
   *
   * Every miss class now self-heals, so `es_fold_refold_on_miss_total` CAN
   * reach zero for this adopter and the option earns deletion once the
   * pre-00056 rows age out. The two classes that could not: the log-only
   * trace's row landed in partition `196952` already past its TTL and was
   * reaped (closed by the storage anchor, 00061), and the dimension-only
   * trace folded a state the store's persistability gate refused to write
   * (closed by the always-write change — the row is always written now, and
   * analytics readers exclude it via TRACE_ANALYTICS_HAS_SIGNAL_SQL).
   *
   * `trustAbsentMiss: true` — the other half of always-write. With every
   * committed state guaranteed a row, an absent read proves the aggregate is
   * new, so the executor folds from `init()` without the unwindowed fallback
   * scan or the store-miss re-fold. The re-folds this retires were measured at
   * ~111/min with 93% returning exactly the delivered batch; the fallback
   * scans at ~110/min with 0 recoveries in 30 days (150,573 attempts). The
   * `undecodable` transitional net above is NOT affected — a refused row still
   * re-folds.
   *
   * `coalesceMaxBatch` — see below.
   *
   * `refoldOnOutOfOrder: false` — spans are distributed and arrive in any order,
   * and a late event folds onto the loaded state in place; no history replay
   * derives anything. WITHOUT this a hot trace (a Claude Code session streams
   * 100k+ events into one aggregate) re-folded its ENTIRE history on every
   * out-of-order batch, pinning the checkpoint at the max occurredAt so every
   * later batch looked out of order too — an O(n²) death spiral that never
   * caught up (2026-07-09 incident; see
   * specs/trace-processing/hot-trace-fold-amplification.feature).
   *
   * Precision about "order-insensitive", because the executor keys on this flag
   * to choose the STREAMING refold (`streamRefoldUpToDelivered`, whose pages
   * arrive in log-append rather than `occurredAt` order): every DERIVED field
   * here commutes IN VALUE — sums, counters, min/max, LWW-by-occurredAt.
   * (`Models` commutes as a set; `mergeModelsMostRecentFirst` makes its
   * most-recent-first ORDER arrival-dependent, which no consumer reads.)
   * `storageAnchorMs`
   * does not: it is first-observed by construction. That is deliberate and it is
   * safe here, because the anchor is a STORAGE address rather than a derived
   * value — a rebuild that reaches a different first event still produces a valid
   * anchor, and the committed one is preserved across the only transition that
   * would otherwise re-derive it population-wide (the pre-split decode above).
   * A field that is both first-observed AND read by consumers would not be safe
   * on this path.
   */
  override options: FoldProjectionOptions = {
    refoldOnStoreMiss: true,
    trustAbsentMiss: true,
    refoldOnOutOfOrder: false,
    readWindow: { widthMs: TRACE_ANALYTICS_READ_WINDOW_MS },
    coalesceMaxBatch: TRACE_ANALYTICS_COALESCE_MAX_BATCH,
  };

  constructor(deps: { store: FoldProjectionStore<TraceAnalyticsData> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
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
  override apply(
    state: TraceAnalyticsData,
    event: { type: string },
  ): TraceAnalyticsData {
    const folded = super.apply(state, event);
    if (folded === state) return state;
    const eventOccurredAt = (event as { occurredAt?: unknown }).occurredAt;
    return anchorStorageTime({
      state: folded,
      eventOccurredAtMs:
        typeof eventOccurredAt === "number" ? eventOccurredAt : undefined,
    });
  }

  handleTraceSpanReceived(
    event: SpanReceivedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    // Past the processing cap, keep counting but skip the expensive
    // normalization + derivation. Mirrors the trace-summary fold so the cap
    // boundary triggers in both folds at the same span.
    if (state.spanCount >= MAX_PROCESSED_SPANS) {
      return { ...state, spanCount: state.spanCount + 1 };
    }

    const normalizedSpan =
      spanNormalizationPipelineService.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      );
    enrichRagContextIds(normalizedSpan);

    return applySpanToAnalytics({ state, span: normalizedSpan });
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

    // Run the canonical extractor registry against this log record — each
    // extractor lifts model / cost / tokens / cache / thread.id onto
    // canonical langwatch.* keys. Slim mirrors the trace-summary fold's
    // canonical lift so log-only emitters (Claude Code Path B, Codex Path
    // B) populate the slim columns even though no spans ever arrive.
    return applyLogContribution({
      state,
      contribution: {
        traceId: event.data.traceId,
        liftedAttributes: liftCanonicalAttributesFromLogRecord(event.data),
        nonBillable:
          event.data.resourceAttributes?.[NON_BILLABLE_ATTR] === "true",
      },
    });
  }

  handleTraceLogContributed(
    event: LogContributedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    return applyLogContribution({
      state,
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
        timeToFirstTokenMs === null
          ? ttftMs
          : Math.min(timeToFirstTokenMs, ttftMs);
    }

    // Counts exemplar correlations, not metric data points: the canonical
    // datapoint stream is a separate pipeline this fold never sees, so it
    // cannot know how many points a trace's metrics produced.
    const mergedAttributes = { ...state.attributes };
    const correlationCount = parseInt(
      mergedAttributes[METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE] ?? "0",
      10,
    );
    mergedAttributes[METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE] = String(
      correlationCount + 1,
    );

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
    const merged = [
      ...new Set([...(state.annotationIds ?? []), ...event.data.annotationIds]),
    ];
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
}
