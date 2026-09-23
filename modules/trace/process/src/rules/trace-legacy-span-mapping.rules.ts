import type {
  NormalizedAttributes,
  NormalizedSpan,
  BaseSpan,
  Span,
  SpanMetrics,
  SpanTimestamps,
  SpanTypes,
} from "@langwatch/trace-contract";
import { safeUnflatten } from "@langwatch/trace-contract";

import { TraceSpanCostMatchingService } from "../services/trace-span-cost-matching.service.ts";
import {
  extractContexts,
  extractError,
  extractInput,
  findModel,
  extractOutput,
  findVendor,
} from "./legacy-span-attributes.rules.ts";
import { coerceToNumber } from "./trace-number-coercion.rules.ts";

/**
 * Extracts metrics from canonical span attributes only.
 * After canonicalization, tokens are at gen_ai.usage.input_tokens/output_tokens.
 * Falls back to gen_ai.usage.prompt_tokens/completion_tokens for compat.
 */
function extractMetrics(spanAttributes: NormalizedAttributes): SpanMetrics | null {
  const promptTokens = coerceToNumber(
    spanAttributes["gen_ai.usage.input_tokens"] ?? spanAttributes["gen_ai.usage.prompt_tokens"],
  );

  const completionTokens = coerceToNumber(
    spanAttributes["gen_ai.usage.output_tokens"] ??
      spanAttributes["gen_ai.usage.completion_tokens"],
  );

  const reasoningTokens = coerceToNumber(spanAttributes["gen_ai.usage.reasoning_tokens"]);
  const tokensEstimated = spanAttributes["langwatch.tokens.estimated"];

  // Canonical name with Mastra non-standard fallback
  const cacheReadInputTokens = coerceToNumber(
    spanAttributes["gen_ai.usage.cache_read.input_tokens"] ??
      spanAttributes["gen_ai.usage.cached_input_tokens"],
  );
  const cacheCreationInputTokens = coerceToNumber(
    spanAttributes["gen_ai.usage.cache_creation.input_tokens"],
  );

  const rawCost = TraceSpanCostMatchingService.computeSpanCost({
    attrs: spanAttributes,
    promptTokens,
    completionTokens,
  });
  const cost = rawCost > 0 ? rawCost : null;

  const hasNoMetricsSignal =
    promptTokens === null &&
    completionTokens === null &&
    reasoningTokens === null &&
    cost === null &&
    cacheReadInputTokens === null &&
    cacheCreationInputTokens === null &&
    typeof tokensEstimated !== "boolean";
  if (hasNoMetricsSignal) {
    return null;
  }

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    reasoning_tokens: reasoningTokens,
    cache_read_input_tokens: cacheReadInputTokens,
    cache_creation_input_tokens: cacheCreationInputTokens,
    cost: cost,
    tokens_estimated: typeof tokensEstimated === "boolean" ? tokensEstimated : null,
  };
}

/**
 * Converts flat dot-notation keys into nested objects, e.g. {"gen_ai.usage.input_tokens": 100}
 * → {"gen_ai": {"usage": {"input_tokens": 100}}}. Keys without dots stay at top level.
 */
export function unflattenDotNotation(flat: NormalizedAttributes): Record<string, unknown> {
  return safeUnflatten(flat as Record<string, unknown>);
}

/**
 * Maps a NormalizedSpan (from ClickHouse stored_spans) to the legacy Span type
 * used by the pre-ClickHouse trace system.
 */
export function mapNormalizedSpanToSpan(normalizedSpan: NormalizedSpan): Span {
  const timestamps: SpanTimestamps = {
    started_at: normalizedSpan.startTimeUnixMs,
    finished_at: normalizedSpan.endTimeUnixMs,
    first_token_at: null,
  };

  // Check for first token event
  const firstTokenEvent = normalizedSpan.events.find(
    (event) => event.name === "first_token" || event.name === "gen_ai.content.first_token",
  );
  if (firstTokenEvent) {
    timestamps.first_token_at = firstTokenEvent.timeUnixMs;
  }

  const spanType = normalizedSpan.spanAttributes["langwatch.span.type"] as SpanTypes;

  const baseSpan: BaseSpan = {
    span_id: normalizedSpan.spanId,
    parent_id: normalizedSpan.parentSpanId,
    trace_id: normalizedSpan.traceId,
    type: typeof spanType === "string" ? spanType : ("span" as const),
    name: normalizedSpan.name,
    input: extractInput(normalizedSpan.spanAttributes),
    output: extractOutput(normalizedSpan.spanAttributes),
    error: extractError({
      statusCode: normalizedSpan.statusCode,
      statusMessage: normalizedSpan.statusMessage,
      spanAttributes: normalizedSpan.spanAttributes,
      events: normalizedSpan.events,
    }),
    timestamps,
    metrics: extractMetrics(normalizedSpan.spanAttributes),
    params: unflattenDotNotation(normalizedSpan.spanAttributes),
  };

  // Add LLM-specific fields
  if (baseSpan.type === "llm") {
    return {
      ...baseSpan,
      type: "llm" as const,
      model: findModel(normalizedSpan.spanAttributes),
      vendor: findVendor(normalizedSpan.spanAttributes),
    };
  }

  // Add RAG-specific fields
  if (baseSpan.type === "rag") {
    return {
      ...baseSpan,
      type: "rag" as const,
      contexts: extractContexts(normalizedSpan.spanAttributes) ?? [],
    };
  }

  return baseSpan;
}

/** Maps multiple NormalizedSpans to legacy Span format. */
export function mapNormalizedSpansToSpans(normalizedSpans: NormalizedSpan[]): Span[] {
  return normalizedSpans.map(mapNormalizedSpanToSpan);
}
