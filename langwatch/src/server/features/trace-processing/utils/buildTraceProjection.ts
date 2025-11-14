import type { EventStream } from "../library";
import type { SpanEvent, TraceProjectionData } from "../types";
import { buildSpanTree } from "./spanTreeBuilder";
import {
  aggregateTokenMetrics,
  computeTimingMetrics,
  deriveModelInfo,
  deriveStatusFlags,
  deriveTokensPerSecond,
  detectInputOutput,
  mergeHeuristics,
} from "./projectionHeuristics";

/**
 * Builds a trace projection from span events.
 * Currently contains stubs for all computed metrics.
 */
export function buildTraceProjection(
  stream: EventStream<string, SpanEvent>
): TraceProjectionData {
  const events = stream.getEvents();
  if (events.length === 0) {
    throw new Error("Cannot build projection from empty events");
  }

  const firstEvent = events[0]!;
  const tenantId = firstEvent.metadata?.tenantId ?? "";
  const traceId = stream.getAggregateId();
  const spanForest = buildSpanTree(events);
  const now = Date.now();

  const baseProjection: TraceProjectionData = {
    tenantId,
    traceId,
    computedInput: null,
    computedOutput: null,
    computedMetadata: {
      root_span_count: String(spanForest.length),
    },
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    totalDurationMs: 0,
    tokensPerSecond: null,
    spanCount: events.length,
    containsErrorStatus: false,
    containsOKStatus: false,
    models: null,
    topicId: null,
    subTopicId: null,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    hasAnnotation: null,
    createdAt: firstEvent.metadata?.collectedAtUnixMs ?? now,
    lastUpdatedAt: now,
  };

  const heuristicsResults = [
    detectInputOutput(events),
    computeTimingMetrics(events),
    deriveStatusFlags(events),
    deriveModelInfo(events),
    aggregateTokenMetrics(events),
  ];

  const withHeuristics = mergeHeuristics(baseProjection, ...heuristicsResults);
  const tokensPerSecondResult = deriveTokensPerSecond(withHeuristics);

  return mergeHeuristics(withHeuristics, tokensPerSecondResult);
}
