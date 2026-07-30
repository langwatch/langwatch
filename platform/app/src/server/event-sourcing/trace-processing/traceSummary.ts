import type { AggregateEvent } from "@langwatch/event-sourcing";
import { trace } from "./aggregate";
import {
  applyOriginSpan,
  extractOriginSignals,
  legacyMarkerStripping,
  resolveOrigin,
} from "./originClassification";
import type { CanonicalSpan, LogContribution, OriginResolution, TopicAssignment } from "./schema";
import {
  MAX_PROCESSED_SPANS,
  addPIISpanId,
  anchorOnce,
  applyAnnotationBulkSync,
  applyAnnotationChange,
  attributeValues,
  betterErrorMessage,
  betterIOCandidate,
  isLaterPrompt,
  mergeAttribute,
  mergeModelUsage,
  mergeNameCandidate,
  orderedModels,
  presentAnnotationIds,
  roundCost,
  spanContainsAi,
  spanType as spanTypeOf,
} from "./spanDerivation";
import { initTraceSummaryState, type PromptCandidateWithVersion, type TraceSummaryState } from "./traceSummary.schema";

/**
 * The `traceSummary` fold. Every accumulator is a `spanDerivation.ts` or
 * `originClassification.ts` merge that is commutative, monotone over a
 * declared lattice, or last-write-wins carrying its own domain stamp
 * (ADR-098 §4) — none of them compares against what the fold already decided.
 */

const PROMPT_ID_ATTR = "langwatch.prompt_ids";
const LABELS_ATTR = "langwatch.labels";

export const TRACE_SUMMARY_PROJECTION_NAME = "traceSummary";

// ---------------------------------------------------------------------------
// spanReceived
// ---------------------------------------------------------------------------

function applySpanTiming(state: TraceSummaryState, span: CanonicalSpan): Pick<TraceSummaryState, "occurredAt" | "totalDurationMs"> {
  if (!Number.isFinite(span.startTimeUnixMs) || !Number.isFinite(span.endTimeUnixMs)) {
    return { occurredAt: state.occurredAt, totalDurationMs: state.totalDurationMs };
  }
  const occurredAt = state.occurredAt > 0 ? Math.min(state.occurredAt, span.startTimeUnixMs) : span.startTimeUnixMs;
  const currentEnd = state.occurredAt > 0 ? state.occurredAt + state.totalDurationMs : 0;
  const totalDurationMs = Math.max(currentEnd, span.endTimeUnixMs) - occurredAt;
  return { occurredAt, totalDurationMs };
}

function errorMessageRank(source: "exception" | "attribute" | "statusMessage"): 1 | 2 | 3 {
  return source === "exception" ? 3 : source === "attribute" ? 2 : 1;
}

/** Within-span priority (carried over unchanged — see `spanDerivation.ts`'s docblock). */
function extractSpanErrorMessage(span: CanonicalSpan): { message: string; source: "exception" | "attribute" | "statusMessage" } | null {
  if (span.exceptionMessage) return { message: span.exceptionMessage, source: "exception" };
  const attrMessage = span.attributes["exception.message"] ?? span.attributes["error.message"];
  if (typeof attrMessage === "string" && attrMessage.length > 0) {
    return { message: attrMessage, source: "attribute" };
  }
  if (span.statusCode === "ERROR" && span.statusMessage) {
    return { message: span.statusMessage, source: "statusMessage" };
  }
  return null;
}

function applyIO(state: TraceSummaryState, span: CanonicalSpan): Pick<TraceSummaryState, "computedInput" | "computedOutput"> {
  const isRoot = span.parentSpanId === null;
  const tier = (explicit: boolean): 0 | 1 | 2 => (isRoot ? 2 : explicit ? 1 : 0);

  const inputCandidate =
    span.io.inputText !== null
      ? { text: span.io.inputText, tier: tier(span.io.inputIsExplicit), endTimeMs: span.endTimeUnixMs, spanId: span.spanId }
      : null;
  const outputCandidate =
    span.io.outputText !== null
      ? { text: span.io.outputText, tier: tier(span.io.outputIsExplicit), endTimeMs: span.endTimeUnixMs, spanId: span.spanId }
      : null;

  return {
    computedInput: betterIOCandidate(state.computedInput, inputCandidate),
    computedOutput: betterIOCandidate(state.computedOutput, outputCandidate),
  };
}

function applyNameCandidates(state: TraceSummaryState, span: CanonicalSpan): Pick<TraceSummaryState, "rootCandidate" | "fallbackCandidate"> {
  if (!span.name) return { rootCandidate: state.rootCandidate, fallbackCandidate: state.fallbackCandidate };
  const candidate = {
    spanId: span.spanId,
    startTimeMs: span.startTimeUnixMs,
    name: span.name,
    spanType: spanTypeOf(span),
  };
  const isRoot = span.parentSpanId === null;
  return {
    rootCandidate: isRoot ? mergeNameCandidate(state.rootCandidate, candidate) : state.rootCandidate,
    fallbackCandidate: !isRoot ? mergeNameCandidate(state.fallbackCandidate, candidate) : state.fallbackCandidate,
  };
}

function applyAttributes(state: TraceSummaryState, span: CanonicalSpan) {
  let attributes = state.attributes;
  for (const [key, value] of Object.entries(span.attributes)) {
    if (key === LABELS_ATTR || key === PROMPT_ID_ATTR) continue;
    if (key.startsWith("langwatch.reserved.")) continue; // tracked separately (PII sets) or not surfaced
    attributes = mergeAttribute(attributes, key, String(value), span.spanId);
  }

  let labels = state.labels;
  const rawLabels = span.attributes[LABELS_ATTR];
  if (Array.isArray(rawLabels)) {
    labels = new Set(labels);
    for (const label of rawLabels) if (typeof label === "string") labels.add(label);
  }

  let promptIds = state.promptIds;
  const rawPromptIds = span.attributes[PROMPT_ID_ATTR];
  if (Array.isArray(rawPromptIds)) {
    promptIds = new Set(promptIds);
    for (const id of rawPromptIds) if (typeof id === "string") promptIds.add(id);
  }

  return { attributes, labels, promptIds };
}

function applyPromptTracking(state: TraceSummaryState, span: CanonicalSpan): Pick<TraceSummaryState, "containsPrompt" | "selectedPrompt" | "lastUsedPrompt"> {
  if (!span.prompt) {
    return { containsPrompt: state.containsPrompt, selectedPrompt: state.selectedPrompt, lastUsedPrompt: state.lastUsedPrompt };
  }
  const candidate: PromptCandidateWithVersion = {
    promptId: span.prompt.promptId,
    versionId: span.prompt.versionId,
    versionNumber: span.prompt.versionNumber,
    spanId: span.spanId,
    startTimeMs: span.startTimeUnixMs,
  };
  // `selectedPrompt` — the first prompt a trace used (earliest span wins,
  // tie-broken bytewise on spanId — the mirror image of `isLaterPrompt`);
  // `lastUsedPrompt` — the most recent (latest span wins, via the old
  // service's already-correct, already order-invariant `isLaterPrompt`
  // comparator — see `spanDerivation.ts`).
  const isEarlier =
    state.selectedPrompt === null ||
    span.startTimeUnixMs < state.selectedPrompt.startTimeMs ||
    (span.startTimeUnixMs === state.selectedPrompt.startTimeMs && span.spanId < state.selectedPrompt.spanId);
  const selectedPrompt = isEarlier ? candidate : state.selectedPrompt;
  const lastUsedPrompt = isLaterPrompt(state.lastUsedPrompt, candidate) ? candidate : state.lastUsedPrompt;
  return { containsPrompt: true, selectedPrompt, lastUsedPrompt };
}

export function handleSpanReceived(state: TraceSummaryState, span: CanonicalSpan): TraceSummaryState {
  const spanCount = state.spanCount + 1;
  // This table's own ADR-099 storage anchor — see traceSummary.schema.ts's
  // `acceptedAtMs` docblock. Frozen even past the processing cap, so a
  // pathologically large trace still lands in a stable partition.
  const acceptedAtMs = anchorOnce(state.acceptedAtMs, span.startTimeUnixMs || span.occurredAt);

  if (state.derivedSpanCount >= MAX_PROCESSED_SPANS) {
    // Past the processing cap: keep counting (unbounded, order-invariant),
    // stop deriving. See spanDerivation.ts's MAX_PROCESSED_SPANS docblock —
    // this is the fix for "no drop mechanism, only lighter processing"
    // (specs/trace-processing/oversized-trace-lighter-processing.feature).
    return { ...state, spanCount, acceptedAtMs };
  }

  const timing = applySpanTiming(state, span);
  const io = applyIO(state, span);
  const names = applyNameCandidates(state, span);
  const { attributes, labels, promptIds } = applyAttributes(state, span);
  const prompts = applyPromptTracking(state, span);

  const errorInfo = extractSpanErrorMessage(span);
  const errorMessage = betterErrorMessage(
    state.errorMessage,
    errorInfo ? { message: errorInfo.message, rank: errorMessageRank(errorInfo.source), spanId: span.spanId } : null,
  );
  const containsErrorStatus = state.containsErrorStatus || span.statusCode === "ERROR" || errorInfo !== null;
  const containsOKStatus = state.containsOKStatus || span.statusCode === "OK";

  const modelUsage = span.model ? mergeModelUsage(state.modelUsage, span.model, span.startTimeUnixMs) : state.modelUsage;

  const hasTokenUsage =
    state.hasTokenUsage ||
    span.usage.inputTokens !== null ||
    span.usage.outputTokens !== null ||
    span.usage.reasoningTokens !== null;
  const tokensEstimated = state.tokensEstimated || span.usage.estimated;
  const totalPromptTokenCount = state.totalPromptTokenCount + (span.usage.inputTokens ?? 0);
  const totalCompletionTokenCount = state.totalCompletionTokenCount + (span.usage.outputTokens ?? 0);
  // Sum once, round once (at read time) — never re-round the running total on
  // every step. See spanDerivation.ts's roundCost docblock for the defect
  // this fixes.
  const totalCostRaw = state.totalCostRaw + (span.cost.cost ?? 0);
  const nonBilledCostRaw = state.nonBilledCostRaw + (span.cost.nonBilledCost ?? 0);

  const timeToFirstTokenMs =
    span.timeToFirstTokenMs !== null
      ? state.timeToFirstTokenMs !== null
        ? Math.min(state.timeToFirstTokenMs, span.timeToFirstTokenMs)
        : span.timeToFirstTokenMs
      : state.timeToFirstTokenMs;
  const timeToLastTokenMs =
    span.timeToLastTokenMs !== null
      ? state.timeToLastTokenMs !== null
        ? Math.max(state.timeToLastTokenMs, span.timeToLastTokenMs)
        : span.timeToLastTokenMs
      : state.timeToLastTokenMs;

  const blockedByGuardrail = state.blockedByGuardrail || spanTypeOf(span) === "guardrail";
  const containsAi = state.containsAi || spanContainsAi(span);

  const origin = applyOriginSpan(state.origin, extractOriginSignals(span));

  let piiPartialSpanIds = state.piiPartialSpanIds;
  let piiSkippedSpanIds = state.piiSkippedSpanIds;
  if (span.piiRedactionStatus === "partial") piiPartialSpanIds = addPIISpanId(piiPartialSpanIds, span.spanId);
  if (span.piiRedactionStatus === "none") piiSkippedSpanIds = addPIISpanId(piiSkippedSpanIds, span.spanId);

  return {
    ...state,
    // `init()` has no way to know the fold's own key (`FoldExecutorDeps.init`
    // takes no arguments) — `traceId` is purely informational and is never
    // used for the row's key, which the store derives from its own `key`
    // parameter instead. Filled in from the first span that carries it.
    traceId: state.traceId || span.traceId,
    spanCount,
    derivedSpanCount: state.derivedSpanCount + 1,
    acceptedAtMs,
    ...timing,
    ...io,
    ...names,
    attributes,
    labels,
    promptIds,
    ...prompts,
    errorMessage,
    containsErrorStatus,
    containsOKStatus,
    modelUsage,
    hasTokenUsage,
    tokensEstimated,
    totalPromptTokenCount,
    totalCompletionTokenCount,
    totalCostRaw,
    nonBilledCostRaw,
    timeToFirstTokenMs,
    timeToLastTokenMs,
    blockedByGuardrail,
    containsAi,
    origin,
    piiPartialSpanIds,
    piiSkippedSpanIds,
  };
}

// ---------------------------------------------------------------------------
// topicAssigned — LWW on the assigner's own stamp, never occurredAt
// ---------------------------------------------------------------------------

export function handleTopicAssigned(state: TraceSummaryState, data: TopicAssignment): TraceSummaryState {
  if (data.assignedAt < state.topicAssignedAt) return state;
  return {
    ...state,
    topicId: data.topicId,
    subTopicId: data.subtopicId,
    topicAssignedAt: data.assignedAt,
  };
}

// ---------------------------------------------------------------------------
// originResolved — a fallback command's own explicit assertion. Folded
// through the same origin state as span-derived signals (root-span-shaped:
// the resolving command always addresses the whole trace, so it is treated
// as a root-span-equivalent explicit signal keyed on a stable synthetic id
// so redelivery of the identical resolution is a no-op).
// ---------------------------------------------------------------------------

export function handleOriginResolved(state: TraceSummaryState, data: OriginResolution): TraceSummaryState {
  return {
    ...state,
    origin: applyOriginSpan(state.origin, {
      spanId: `origin-resolved:${data.traceId}`,
      isRoot: true,
      explicitOrigin: data.origin,
    }),
  };
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export function handleAnnotationAdded(state: TraceSummaryState, data: { annotationId: string; actedAt: number }): TraceSummaryState {
  return { ...state, annotations: applyAnnotationChange(state.annotations, data.annotationId, true, data.actedAt) };
}

export function handleAnnotationRemoved(state: TraceSummaryState, data: { annotationId: string; actedAt: number }): TraceSummaryState {
  return { ...state, annotations: applyAnnotationChange(state.annotations, data.annotationId, false, data.actedAt) };
}

export function handleAnnotationsBulkSynced(
  state: TraceSummaryState,
  data: { annotationIds: readonly string[]; actedAt: number },
): TraceSummaryState {
  return { ...state, annotations: applyAnnotationBulkSync(state.annotations, data.annotationIds, data.actedAt) };
}

// ---------------------------------------------------------------------------
// traceNameChanged — a user override latches, and is authoritative over the
// derived name forever after (though root-span METADATA keeps updating —
// see deriveTraceSummaryView).
// ---------------------------------------------------------------------------

export function handleTraceNameChanged(state: TraceSummaryState, data: { newName: string }): TraceSummaryState {
  return { ...state, traceNameOverride: data.newName };
}

// ---------------------------------------------------------------------------
// logContributed — a canonical log record's contribution. Mirrors the span
// path for the fields a log can carry, additively and order-invariantly.
// ---------------------------------------------------------------------------

export function handleLogContributed(state: TraceSummaryState, data: LogContribution): TraceSummaryState {
  const bodyText = data.body || null;
  const io: Pick<TraceSummaryState, "computedInput" | "computedOutput"> = bodyText
    ? {
        computedInput: state.computedInput,
        computedOutput: betterIOCandidate(state.computedOutput, {
          text: bodyText,
          tier: 0,
          endTimeMs: data.timeUnixMs,
          spanId: data.spanId,
        }),
      }
    : { computedInput: state.computedInput, computedOutput: state.computedOutput };

  return { ...state, ...io };
}

// ---------------------------------------------------------------------------
// metricDataPointCorrelated — a correlated exemplar can independently supply
// a time-to-first-token reading (min-accumulated, same as the span path).
// ---------------------------------------------------------------------------

export function handleMetricDataPointCorrelated(
  state: TraceSummaryState,
  data: { metricName: string; exemplarValue: number | null },
): TraceSummaryState {
  if (data.metricName !== "gen_ai.server.time_to_first_token" || data.exemplarValue === null) return state;
  const timeToFirstTokenMs =
    state.timeToFirstTokenMs !== null ? Math.min(state.timeToFirstTokenMs, data.exemplarValue) : data.exemplarValue;
  return { ...state, timeToFirstTokenMs };
}

export function initTraceSummary(traceId: string): TraceSummaryState {
  return initTraceSummaryState(traceId);
}

const summaryHandlers = new Map<string, (state: TraceSummaryState, data: never) => TraceSummaryState>([
  [trace.eventType("spanReceived"), handleSpanReceived],
  [trace.eventType("topicAssigned"), handleTopicAssigned],
  [trace.eventType("originResolved"), handleOriginResolved],
  [trace.eventType("annotationAdded"), handleAnnotationAdded],
  [trace.eventType("annotationRemoved"), handleAnnotationRemoved],
  [trace.eventType("annotationsBulkSynced"), handleAnnotationsBulkSynced],
  [trace.eventType("traceNameChanged"), handleTraceNameChanged],
  [trace.eventType("logContributed"), handleLogContributed],
  [trace.eventType("metricDataPointCorrelated"), handleMetricDataPointCorrelated],
]);

export function applyTraceSummary(state: TraceSummaryState, event: AggregateEvent): TraceSummaryState {
  const handler = summaryHandlers.get(event.type);
  return handler ? handler(state, event.data as never) : state;
}

// ---------------------------------------------------------------------------
// Derivation — everything computed from state at read time, never stored
// ---------------------------------------------------------------------------

export interface TraceSummaryView {
  readonly traceId: string;
  readonly spanCount: number;
  readonly derivationCapped: boolean;
  readonly occurredAt: number;
  readonly totalDurationMs: number;
  readonly computedInput: string | null;
  readonly computedOutput: string | null;
  readonly timeToFirstTokenMs: number | null;
  readonly timeToLastTokenMs: number | null;
  readonly tokensPerSecond: number | null;
  readonly containsErrorStatus: boolean;
  readonly containsOKStatus: boolean;
  readonly errorMessage: string | null;
  readonly models: readonly string[];
  readonly totalCost: number | null;
  readonly nonBilledCost: number | null;
  readonly hasTokenUsage: boolean;
  readonly tokensEstimated: boolean;
  readonly totalPromptTokenCount: number | null;
  readonly totalCompletionTokenCount: number | null;
  readonly blockedByGuardrail: boolean;
  readonly containsAi: boolean;
  readonly containsPrompt: boolean;
  readonly selectedPrompt: PromptCandidateWithVersion | null;
  readonly lastUsedPrompt: PromptCandidateWithVersion | null;
  readonly traceName: string;
  readonly rootSpanType: string | null;
  readonly rootSpanStartTimeMs: number | null;
  readonly traceNameFromFallback: boolean;
  readonly topicId: string | null;
  readonly subTopicId: string | null;
  readonly annotationIds: readonly string[];
  readonly attributes: Record<string, string>;
}

export function deriveTraceSummaryView(state: TraceSummaryState): TraceSummaryView {
  const rootOrFallback = state.rootCandidate ?? state.fallbackCandidate;
  const traceName = state.traceNameOverride ?? rootOrFallback?.name ?? "";
  const origin = resolveOrigin(state.origin);
  const stripping = legacyMarkerStripping(state.origin);

  const attributes = attributeValues(state.attributes);
  if (origin !== null) attributes["langwatch.origin"] = origin;
  if (stripping.stripPlatform) delete attributes["langwatch.platform"];
  const labels = stripping.stripScenarioRunnerLabel
    ? [...state.labels].filter((label) => label !== "scenario-runner")
    : [...state.labels];
  if (labels.length > 0) attributes["langwatch.labels"] = JSON.stringify(labels);
  if (state.promptIds.size > 0) attributes["langwatch.prompt_ids"] = JSON.stringify([...state.promptIds]);
  if (state.piiPartialSpanIds.ids.size > 0) {
    attributes["langwatch.reserved.pii_redaction_partial_span_ids"] = JSON.stringify([...state.piiPartialSpanIds.ids]);
  }
  if (state.piiSkippedSpanIds.ids.size > 0) {
    attributes["langwatch.reserved.pii_redaction_skipped_span_ids"] = JSON.stringify([...state.piiSkippedSpanIds.ids]);
  }

  const tokensPerSecond =
    state.totalCompletionTokenCount > 0 && state.totalDurationMs > 0
      ? Math.round((state.totalCompletionTokenCount / state.totalDurationMs) * 1000)
      : null;

  return {
    traceId: state.traceId,
    spanCount: state.spanCount,
    derivationCapped: state.spanCount > state.derivedSpanCount,
    occurredAt: state.occurredAt,
    totalDurationMs: state.totalDurationMs,
    computedInput: state.computedInput?.text ?? null,
    computedOutput: state.computedOutput?.text ?? null,
    timeToFirstTokenMs: state.timeToFirstTokenMs,
    timeToLastTokenMs: state.timeToLastTokenMs,
    tokensPerSecond,
    containsErrorStatus: state.containsErrorStatus,
    containsOKStatus: state.containsOKStatus,
    errorMessage: state.errorMessage?.message ?? null,
    models: orderedModels(state.modelUsage),
    totalCost: state.totalCostRaw !== 0 ? roundCost(state.totalCostRaw) : state.hasTokenUsage ? 0 : null,
    nonBilledCost: state.nonBilledCostRaw !== 0 ? roundCost(state.nonBilledCostRaw) : null,
    hasTokenUsage: state.hasTokenUsage,
    tokensEstimated: state.tokensEstimated,
    totalPromptTokenCount: state.hasTokenUsage ? state.totalPromptTokenCount : null,
    totalCompletionTokenCount: state.hasTokenUsage ? state.totalCompletionTokenCount : null,
    blockedByGuardrail: state.blockedByGuardrail,
    containsAi: state.containsAi,
    containsPrompt: state.containsPrompt,
    selectedPrompt: state.selectedPrompt,
    lastUsedPrompt: state.lastUsedPrompt,
    traceName,
    rootSpanType: rootOrFallback?.spanType ?? null,
    rootSpanStartTimeMs: rootOrFallback?.startTimeMs ?? null,
    traceNameFromFallback: state.traceNameOverride === null && state.rootCandidate === null && state.fallbackCandidate !== null,
    topicId: state.topicId,
    subTopicId: state.subTopicId,
    annotationIds: presentAnnotationIds(state.annotations),
    attributes,
  };
}
