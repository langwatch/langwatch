import { SYNTHETIC_TRACE_SPAN_NAMES } from "../../trace.constants.ts";
import type { NormalizedSpan } from "../../trace.spans.ts";
import {
  accumulateTraceAttributes,
  stampTraceModelMetadata,
} from "../attribute/trace-attribute-accumulation.ts";
import { resolveTraceNameFromSpan } from "../attribute/trace-name-resolution.ts";
import type { TraceSummaryData } from "../ingest/trace-projection.ts";
import {
  accumulateSpanTokens,
  extractSpanCacheTokens,
  extractSpanModels,
  isSpanTokenAccumulationSkipped,
} from "../span/span-cost-metrics.ts";
import { accumulateSpanStatus } from "../span/span-status-fold.ts";
import { accumulateSpanTiming } from "../span/span-timing-fold.ts";

/** Where a trace's computed output came from, stamped as `langwatch.reserved.output_source`. */
export const OUTPUT_SOURCE = {
  EXPLICIT: "explicit",
  INFERRED: "inferred",
} as const;

// Reserved keys for cache/reasoning token sums (per-span numbers don't reach
// the attribute allowlist, so we fold sums here instead of adding CH columns)
export const RESERVED_CACHE_READ_TOKENS = "langwatch.reserved.cache_read_tokens";
export const RESERVED_CACHE_CREATION_TOKENS = "langwatch.reserved.cache_creation_tokens";
export const RESERVED_REASONING_TOKENS = "langwatch.reserved.reasoning_tokens";

/** Add a non-negative delta to a running sum held as a string attribute. Mutates the map. */
export function addReservedTokenSum({
  attributes,
  key,
  delta,
}: {
  attributes: Record<string, string>;
  key: string;
  delta: number;
}): void {
  if (delta <= 0) return;
  const prior = Number(attributes[key] ?? "0");
  attributes[key] = String((Number.isFinite(prior) ? prior : 0) + delta);
}

/** The incoming models first (deduplicated, non-empty), then the earlier ones not repeated. */
export function mergeModelsMostRecentFirst({
  existing,
  incoming,
}: {
  existing: string[];
  incoming: string[];
}): string[] {
  const fresh = [...new Set(incoming)].filter((m) => m.length > 0);
  if (fresh.length === 0) return existing;
  const rest = existing.filter((m) => !fresh.includes(m));
  return [...fresh, ...rest];
}

/**
 * Roll this span's cache/reasoning token counts into the trace-level
 * running sums on reserved attribute keys. A `skip_token_accumulation`
 * span contributes nothing, same gate as prompt/completion tokens.
 */
function accumulateReservedTokenSums(
  attributes: Record<string, string>,
  span: NormalizedSpan,
): void {
  const cacheTokens = isSpanTokenAccumulationSkipped(span)
    ? { cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 }
    : extractSpanCacheTokens(span);

  addReservedTokenSum({
    attributes,
    key: RESERVED_CACHE_READ_TOKENS,
    delta: cacheTokens.cacheReadTokens,
  });
  addReservedTokenSum({
    attributes,
    key: RESERVED_CACHE_CREATION_TOKENS,
    delta: cacheTokens.cacheCreationTokens,
  });
  addReservedTokenSum({
    attributes,
    key: RESERVED_REASONING_TOKENS,
    delta: cacheTokens.reasoningTokens,
  });
}

/**
 * The slim `trace_analytics` row's fold step: one normalised span over the trace state, skipping
 * IO/prompt accumulation. `spanCost` is the span's price and `spanUnpriced` whether no price rule
 * covers it, both looked up by the caller. Synthetic spans leave the state untouched.
 */
export function foldSpanIntoTraceAnalytics({
  state,
  span,
  spanCost,
  spanUnpriced,
}: {
  state: TraceSummaryData;
  span: NormalizedSpan;
  spanCost: number;
  spanUnpriced: boolean;
}): TraceSummaryData {
  if (SYNTHETIC_TRACE_SPAN_NAMES.has(span.name)) {
    return state;
  }

  const timing = accumulateSpanTiming({ state, span });
  const tokens = accumulateSpanTokens({
    state,
    span,
    spanCost,
    spanUnpriced,
    totalDurationMs: timing.totalDurationMs,
  });
  const status = accumulateSpanStatus({ state, span });

  // No IO is extracted here; the neutral "no IO" values keep the reserved
  // output_source / *_is_fallback keys identical to the full summary fold.
  const attributes = accumulateTraceAttributes({
    state,
    span,
    outputSource: OUTPUT_SOURCE.INFERRED,
    inputIsFallback: false,
    outputIsFallback: false,
    inputMediaRefs: null,
    outputMediaRefs: null,
  });

  accumulateReservedTokenSums(attributes, span);

  const models = mergeModelsMostRecentFirst({
    existing: state.models,
    incoming: extractSpanModels(span),
  });
  stampTraceModelMetadata({ attributes, models });

  const { traceName, rootSpanStartTimeMs, traceNameFromFallback, rootMetadataFromFallback } =
    resolveTraceNameFromSpan({ state, span });

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
    unpricedSpanCount: tokens.unpricedSpanCount,
    unpricedModels: tokens.unpricedModels,
    totalPromptTokenCount: tokens.totalPromptTokenCount,
    totalCompletionTokenCount: tokens.totalCompletionTokenCount,
    timeToFirstTokenMs: tokens.timeToFirstTokenMs,
    tokensPerSecond: tokens.tokensPerSecond,
    containsErrorStatus: status.containsErrorStatus,
    attributes,
  };
}
