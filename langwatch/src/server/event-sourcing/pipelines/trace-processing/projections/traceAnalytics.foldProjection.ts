import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import {
  enrichRagContextIds,
  SpanNormalizationPipelineService,
} from "~/server/app-layer/traces/span-normalization.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { SYNTHETIC_SPAN_NAMES } from "~/server/tracer/constants";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import type {
  AnnotationAddedEvent,
  AnnotationRemovedEvent,
  AnnotationsBulkSyncedEvent,
  LogRecordReceivedEvent,
  MetricRecordReceivedEvent,
  OriginResolvedEvent,
  SpanReceivedEvent,
  TopicAssignedEvent,
  TraceNameChangedEvent,
} from "../schemas/events";
import {
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  traceNameChangedEventSchema,
} from "../schemas/events";
import type { NormalizedSpan } from "../schemas/spans";
import {
  MAX_PROCESSED_SPANS,
  mergeModelsMostRecentFirst,
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
  RESERVED_REASONING_TOKENS,
} from "./traceSummary.foldProjection";
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

/**
 * ADR-034 Phase 2: slim per-trace fold projection.
 *
 * Writes to `trace_analytics` (migration 00038) — a ReplacingMergeTree(Version)
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
 * Re-fold safety (ADR-021/022): same state → same canonical projection → same
 * Version → ReplacingMergeTree collapses duplicates. No explicit truncate, no
 * settle, no signs.
 */

const traceAnalyticsEvents = [
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  logRecordReceivedEventSchema,
  metricRecordReceivedEventSchema,
  originResolvedEventSchema,
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  traceNameChangedEventSchema,
] as const;

/** Schema-snapshot version (calendar date). Bump when the slim fold's
 *  derivation rules or trim service contract change so older versions can
 *  be replaced via re-fold. */
export const TRACE_ANALYTICS_PROJECTION_VERSION_LATEST = "2026-06-20" as const;

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
 * What's kept: keys, OccurredAt, hoisted dim columns, metric scalars,
 * HasError + HasAnnotation, and the trimmed Attributes map.
 */
export interface TraceAnalyticsRow {
  tenantId: string;
  traceId: string;
  /** Schema-snapshot version (the LWW dedup key). */
  version: string;
  /** The trace's occurred-at (partition column + lead sort key). */
  occurredAtMs: number;
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

  // Metric scalars
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
 * Project the in-memory slim state into the slim `TraceAnalyticsRow`. Pure:
 * no I/O, no external state.
 *
 * Used by the projection's store adapter to derive the persisted record.
 */
export function projectAnalyticsStateToRow({
  state,
  tenantId,
  version,
}: {
  state: TraceAnalyticsData;
  tenantId: string;
  version: string;
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
    occurredAtMs: state.occurredAt,
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
    cacheReadTokens: readReservedTokenSum(
      attrs["langwatch.reserved.cache_read_tokens"],
    ),
    cacheWriteTokens: readReservedTokenSum(
      attrs["langwatch.reserved.cache_creation_tokens"],
    ),
    reasoningTokens: readReservedTokenSum(
      attrs["langwatch.reserved.reasoning_tokens"],
    ),
    hasError: state.containsErrorStatus,
    hasAnnotation:
      state.annotationIds && state.annotationIds.length > 0 ? true : null,

    attributes: trimAttributesForAnalytics(attrs),
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
  });

  // Roll per-span cache / reasoning token counts into trace-level sums on
  // reserved attribute keys (the drawer popover + slim's cache* columns
  // both read these). Mirrors the trace-summary fold's bookkeeping.
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

  const newModels = spanCostService.extractModelsFromSpan(span);
  const models = mergeModelsMostRecentFirst(state.models, newModels);

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
    // context) are accepted on the wire and persisted to stored_log_records
    // by the map projection, but skipped here so they don't aggregate per
    // tenant under a single empty aggregateId.
    if (!event.data.traceId || !event.data.spanId) {
      return state;
    }

    const mergedAttributes = { ...state.attributes };
    const logCount = parseInt(
      mergedAttributes["langwatch.reserved.log_record_count"] ?? "0",
      10,
    );
    mergedAttributes["langwatch.reserved.log_record_count"] = String(
      logCount + 1,
    );

    // Run the canonical extractor registry against this log record — each
    // extractor lifts model / cost / tokens / cache / thread.id onto
    // canonical langwatch.* keys. Slim mirrors the trace-summary fold's
    // canonical lift so log-only emitters (Claude Code Path B, Codex Path
    // B) populate the slim columns even though no spans ever arrive.
    const liftedAttrs = liftCanonicalAttributesFromLogRecord(event.data);
    for (const [key, value] of Object.entries(liftedAttrs)) {
      mergedAttributes[key] = value as string;
    }

    // Mirror the canonical lift onto slim's top-level columns. Each
    // api_request event is its OWN turn — cost + tokens are additive
    // across turns, models are deduped. Read from liftedAttrs (this
    // event's contribution) NOT mergedAttributes, so cost doesn't
    // double-count across replays.
    let models = state.models;
    let totalCost = state.totalCost;
    let nonBilledCost = state.nonBilledCost;
    let totalPromptTokenCount = state.totalPromptTokenCount;
    let totalCompletionTokenCount = state.totalCompletionTokenCount;
    const liftedModel = liftedAttrs["langwatch.model"];
    if (typeof liftedModel === "string" && liftedModel.length > 0) {
      models = mergeModelsMostRecentFirst(models, [liftedModel]);
    }
    const liftedCost = Number(liftedAttrs["langwatch.cost.usd"]);
    if (Number.isFinite(liftedCost) && liftedCost > 0) {
      totalCost = (totalCost ?? 0) + liftedCost;
      const resAttr = event.data.resourceAttributes?.[NON_BILLABLE_ATTR];
      if (resAttr === "true") {
        nonBilledCost = (nonBilledCost ?? 0) + liftedCost;
      }
    }
    const liftedIn = Number(liftedAttrs["langwatch.input_tokens"]);
    if (Number.isFinite(liftedIn) && liftedIn > 0) {
      totalPromptTokenCount = (totalPromptTokenCount ?? 0) + liftedIn;
    }
    const liftedOut = Number(liftedAttrs["langwatch.output_tokens"]);
    if (Number.isFinite(liftedOut) && liftedOut > 0) {
      totalCompletionTokenCount = (totalCompletionTokenCount ?? 0) + liftedOut;
    }

    return {
      ...state,
      traceId: state.traceId || event.data.traceId,
      attributes: mergedAttributes,
      models,
      totalCost,
      nonBilledCost,
      totalPromptTokenCount,
      totalCompletionTokenCount,
    };
  }

  handleTraceMetricRecordReceived(
    event: MetricRecordReceivedEvent,
    state: TraceAnalyticsData,
  ): TraceAnalyticsData {
    // Mirrors the trace-summary fold: a standalone gauge/sum without
    // exemplar trace context is persisted to stored_metric_records by the
    // map projection but skipped here.
    if (!event.data.traceId || !event.data.spanId) {
      return state;
    }

    let timeToFirstTokenMs = state.timeToFirstTokenMs;
    if (event.data.metricName === "gen_ai.server.time_to_first_token") {
      const ttftMs = event.data.value * 1000;
      timeToFirstTokenMs =
        timeToFirstTokenMs === null
          ? ttftMs
          : Math.min(timeToFirstTokenMs, ttftMs);
    }

    const mergedAttributes = { ...state.attributes };
    const metricCount = parseInt(
      mergedAttributes["langwatch.reserved.metric_record_count"] ?? "0",
      10,
    );
    mergedAttributes["langwatch.reserved.metric_record_count"] = String(
      metricCount + 1,
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
