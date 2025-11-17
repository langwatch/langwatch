import type { SpanData, TraceProjectionData } from "../types";
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
 * Builds a trace projection from span data.
 * Currently contains stubs for all computed metrics.
 */
export function buildTraceProjection(
  tenantId: string,
  traceId: string,
  spans: readonly SpanData[],
): TraceProjectionData {
  if (spans.length === 0) {
    throw new Error("Cannot build projection from empty spans");
  }

  const spanForest = buildSpanTree(spans);
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
    spanCount: spans.length,
    containsErrorStatus: false,
    containsOKStatus: false,
    models: null,
    topicId: null,
    subTopicId: null,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    hasAnnotation: null,
    createdAt: now,
    lastUpdatedAt: now,
  };

  const heuristicsResults = [
    detectInputOutput(spans),
    computeTimingMetrics(spans),
    deriveStatusFlags(spans),
    deriveModelInfo(spans),
    aggregateTokenMetrics(spans),
  ];

  const withHeuristics = mergeHeuristics(baseProjection, ...heuristicsResults);
  const tokensPerSecondResult = deriveTokensPerSecond(withHeuristics);

  return mergeHeuristics(withHeuristics, tokensPerSecondResult);
}

export const TraceProjectionBuilder = {
  buildTraceProjection,
} as const;
