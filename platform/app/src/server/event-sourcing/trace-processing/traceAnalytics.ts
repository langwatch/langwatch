import type { AggregateEvent } from "@langwatch/event-sourcing";
import { trace } from "./aggregate";
import { applyOriginSpan, extractOriginSignals, resolveOrigin } from "./originClassification";
import type { CanonicalSpan, OriginResolution, TopicAssignment } from "./schema";
import {
  MAX_PROCESSED_SPANS,
  anchorOnce,
  applyAnnotationBulkSync,
  applyAnnotationChange,
  attributeValues,
  isBytewiseSmaller,
  mergeAttribute,
  mergeModelUsage,
  mergeNameCandidate,
  orderedModels,
  presentAnnotationIds,
  roundCost,
  spanType as spanTypeOf,
} from "./spanDerivation";
import { initTraceAnalyticsState, type TraceAnalyticsState } from "./traceAnalytics.schema";

/**
 * The `traceAnalytics` fold — ADR-099's slim sibling of `traceSummary`. Both
 * take their derivation helpers from `spanDerivation.ts` and
 * `originClassification.ts`; neither fold imports from the other.
 */

export const TRACE_ANALYTICS_PROJECTION_NAME = "traceAnalytics";

/**
 * Freezes the storage anchor on the first contribution carrying a usable
 * business time. ADR-099 defines the anchor as whichever event landed first,
 * so this is the one deliberately order-dependent field here — a storage
 * address (partition, TTL deadline), never a value a reader compares.
 * `earliestSpanStartMs` is the order-invariant business timestamp.
 */
function anchorStorageTime(state: TraceAnalyticsState, candidateMs: number): number {
  return anchorOnce(state.storageAnchorMs, candidateMs);
}

function applyNameCandidates(state: TraceAnalyticsState, span: CanonicalSpan) {
  if (!span.name) return { rootCandidate: state.rootCandidate, fallbackCandidate: state.fallbackCandidate };
  const candidate = { spanId: span.spanId, startTimeMs: span.startTimeUnixMs, name: span.name, spanType: spanTypeOf(span) };
  const isRoot = span.parentSpanId === null;
  return {
    rootCandidate: isRoot ? mergeNameCandidate(state.rootCandidate, candidate) : state.rootCandidate,
    fallbackCandidate: !isRoot ? mergeNameCandidate(state.fallbackCandidate, candidate) : state.fallbackCandidate,
  };
}

export function handleSpanReceived(state: TraceAnalyticsState, span: CanonicalSpan): TraceAnalyticsState {
  const spanCount = state.spanCount + 1;
  const storageAnchorMs = anchorStorageTime(state, span.startTimeUnixMs || span.occurredAt);

  if (state.derivedSpanCount >= MAX_PROCESSED_SPANS) {
    return { ...state, spanCount, storageAnchorMs };
  }

  const earliestSpanStartMs =
    Number.isFinite(span.startTimeUnixMs) && span.startTimeUnixMs > 0
      ? state.earliestSpanStartMs > 0
        ? Math.min(state.earliestSpanStartMs, span.startTimeUnixMs)
        : span.startTimeUnixMs
      : state.earliestSpanStartMs;
  const currentEnd = state.earliestSpanStartMs > 0 ? state.earliestSpanStartMs + state.totalDurationMs : 0;
  const totalDurationMs =
    Number.isFinite(span.endTimeUnixMs) && earliestSpanStartMs > 0
      ? Math.max(currentEnd, span.endTimeUnixMs) - earliestSpanStartMs
      : state.totalDurationMs;

  const names = applyNameCandidates(state, span);

  let attributes = state.attributes;
  for (const [key, value] of Object.entries(span.attributes)) {
    if (key === "langwatch.labels" || key.startsWith("langwatch.reserved.")) continue;
    attributes = mergeAttribute(attributes, key, String(value), span.spanId);
  }
  let labels = state.labels;
  const rawLabels = span.attributes["langwatch.labels"];
  if (Array.isArray(rawLabels)) {
    labels = new Set(labels);
    for (const l of rawLabels) if (typeof l === "string") labels.add(l);
  }

  const modelUsage = span.model ? mergeModelUsage(state.modelUsage, span.model, span.startTimeUnixMs) : state.modelUsage;
  const hasError = state.hasError || span.statusCode === "ERROR";

  const timeToFirstTokenMs =
    span.timeToFirstTokenMs !== null
      ? state.timeToFirstTokenMs !== null
        ? Math.min(state.timeToFirstTokenMs, span.timeToFirstTokenMs)
        : span.timeToFirstTokenMs
      : state.timeToFirstTokenMs;

  const origin = applyOriginSpan(state.origin, extractOriginSignals(span));

  return {
    ...state,
    // See traceSummary.ts's identical comment — `init()` cannot know the
    // fold's own key; this is informational only, never used for the row's key.
    traceId: state.traceId || span.traceId,
    spanCount,
    derivedSpanCount: state.derivedSpanCount + 1,
    storageAnchorMs,
    earliestSpanStartMs,
    totalDurationMs,
    ...names,
    attributes,
    labels,
    modelUsage,
    hasError,
    totalCostRaw: state.totalCostRaw + (span.cost.cost ?? 0),
    nonBilledCostRaw: state.nonBilledCostRaw + (span.cost.nonBilledCost ?? 0),
    timeToFirstTokenMs,
    promptTokens: state.promptTokens + (span.usage.inputTokens ?? 0),
    completionTokens: state.completionTokens + (span.usage.outputTokens ?? 0),
    cacheReadTokens: state.cacheReadTokens + (span.usage.cacheReadTokens ?? 0),
    cacheWriteTokens: state.cacheWriteTokens + (span.usage.cacheWriteTokens ?? 0),
    reasoningTokens: state.reasoningTokens + (span.usage.reasoningTokens ?? 0),
    origin,
  };
}

export function handleTopicAssigned(state: TraceAnalyticsState, data: TopicAssignment): TraceAnalyticsState {
  if (data.assignedAt < state.topicAssignedAt) return state;
  return { ...state, topicId: data.topicId, subTopicId: data.subtopicId, topicAssignedAt: data.assignedAt };
}

export function handleOriginResolved(state: TraceAnalyticsState, data: OriginResolution): TraceAnalyticsState {
  return {
    ...state,
    origin: applyOriginSpan(state.origin, { spanId: `origin-resolved:${data.traceId}`, isRoot: true, explicitOrigin: data.origin }),
  };
}

export function handleAnnotationAdded(state: TraceAnalyticsState, data: { annotationId: string; actedAt: number }): TraceAnalyticsState {
  return { ...state, annotations: applyAnnotationChange(state.annotations, data.annotationId, true, data.actedAt) };
}
export function handleAnnotationRemoved(state: TraceAnalyticsState, data: { annotationId: string; actedAt: number }): TraceAnalyticsState {
  return { ...state, annotations: applyAnnotationChange(state.annotations, data.annotationId, false, data.actedAt) };
}
export function handleAnnotationsBulkSynced(
  state: TraceAnalyticsState,
  data: { annotationIds: readonly string[]; actedAt: number },
): TraceAnalyticsState {
  return { ...state, annotations: applyAnnotationBulkSync(state.annotations, data.annotationIds, data.actedAt) };
}

export function handleTraceNameChanged(state: TraceAnalyticsState, data: { newName: string }): TraceAnalyticsState {
  return { ...state, traceNameOverride: data.newName };
}

export function initTraceAnalytics(traceId: string): TraceAnalyticsState {
  return initTraceAnalyticsState(traceId);
}

const analyticsHandlers = new Map<
  string,
  (state: TraceAnalyticsState, data: never) => TraceAnalyticsState
>([
  [trace.eventType("spanReceived"), handleSpanReceived],
  [trace.eventType("topicAssigned"), handleTopicAssigned],
  [trace.eventType("originResolved"), handleOriginResolved],
  [trace.eventType("annotationAdded"), handleAnnotationAdded],
  [trace.eventType("annotationRemoved"), handleAnnotationRemoved],
  [trace.eventType("annotationsBulkSynced"), handleAnnotationsBulkSynced],
  [trace.eventType("traceNameChanged"), handleTraceNameChanged],
]);

export function applyTraceAnalytics(
  state: TraceAnalyticsState,
  event: AggregateEvent,
): TraceAnalyticsState {
  const handler = analyticsHandlers.get(event.type);
  return handler ? handler(state, event.data as never) : state;
}

export interface TraceAnalyticsView {
  readonly traceId: string;
  readonly occurredAtMs: number;
  readonly earliestSpanStartMs: number;
  readonly spanCount: number;
  readonly derivationCapped: boolean;
  readonly traceName: string;
  readonly topicId: string | null;
  readonly subTopicId: string | null;
  readonly userId: string | null;
  readonly conversationId: string | null;
  readonly customerId: string | null;
  readonly origin: string | null;
  readonly models: readonly string[];
  readonly labels: readonly string[];
  readonly totalCost: number | null;
  readonly nonBilledCost: number | null;
  readonly totalDurationMs: number;
  readonly timeToFirstTokenMs: number | null;
  readonly tokensPerSecond: number | null;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
  readonly hasError: boolean;
  readonly hasAnnotation: boolean;
  readonly annotationIds: readonly string[];
  readonly attributes: Record<string, string>;
  readonly rootSpanStartTimeMs: number | null;
  readonly traceNameFromFallback: boolean;
}

const USER_ID_ATTR = "langwatch.user_id";
const THREAD_ID_ATTR = "langwatch.thread_id";
const CUSTOMER_ID_ATTR = "langwatch.customer_id";

export function deriveTraceAnalyticsView(state: TraceAnalyticsState): TraceAnalyticsView {
  const rootOrFallback = state.rootCandidate ?? state.fallbackCandidate;
  const attributes = attributeValues(state.attributes);
  const origin = resolveOrigin(state.origin);
  if (origin !== null) attributes["langwatch.origin"] = origin;

  const tokensPerSecond =
    state.completionTokens > 0 && state.totalDurationMs > 0
      ? Math.round((state.completionTokens / state.totalDurationMs) * 1000)
      : null;

  return {
    traceId: state.traceId,
    occurredAtMs: state.storageAnchorMs,
    earliestSpanStartMs: state.earliestSpanStartMs,
    spanCount: state.spanCount,
    derivationCapped: state.spanCount > state.derivedSpanCount,
    traceName: state.traceNameOverride ?? rootOrFallback?.name ?? "",
    topicId: state.topicId,
    subTopicId: state.subTopicId,
    userId: attributes[USER_ID_ATTR] ?? null,
    conversationId: attributes[THREAD_ID_ATTR] ?? null,
    customerId: attributes[CUSTOMER_ID_ATTR] ?? null,
    origin,
    models: orderedModels(state.modelUsage),
    labels: [...state.labels],
    totalCost: state.totalCostRaw !== 0 ? roundCost(state.totalCostRaw) : null,
    nonBilledCost: state.nonBilledCostRaw !== 0 ? roundCost(state.nonBilledCostRaw) : null,
    totalDurationMs: state.totalDurationMs,
    timeToFirstTokenMs: state.timeToFirstTokenMs,
    tokensPerSecond,
    promptTokens: state.promptTokens,
    completionTokens: state.completionTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheWriteTokens: state.cacheWriteTokens,
    reasoningTokens: state.reasoningTokens,
    hasError: state.hasError,
    hasAnnotation: state.annotations.size > 0 && presentAnnotationIds(state.annotations).length > 0,
    annotationIds: presentAnnotationIds(state.annotations),
    attributes,
    rootSpanStartTimeMs: rootOrFallback?.startTimeMs ?? null,
    traceNameFromFallback: state.traceNameOverride === null && state.rootCandidate === null && state.fallbackCandidate !== null,
  };
}

// Re-exported so callers deciding tie-break behaviour by hand (tests) do not
// need to import spanDerivation.ts directly for this one helper.
export { isBytewiseSmaller };
