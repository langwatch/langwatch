import type {
  NormalizedAttributes,
  NormalizedSpan,
  BaseSpan,
  LegacySpanInputOutput,
  Span,
  SpanMetrics,
  SpanTimestamps,
  SpanTypes,
} from "@langwatch/trace-contract";
import {
  legacySpanInputOutputSchema,
  safeUnflatten,
  spanTypesSchema,
} from "@langwatch/trace-contract";

import { computeSpanCost } from "../../span/rules/trace-span-cost-matching.rules.ts";
import {
  extractContexts,
  extractError,
  extractInput,
  findModel,
  extractOutput,
  findVendor,
} from "./legacy-span-attributes.rules.ts";

/**
 * Coerces a value to a finite number or returns null.
 * Handles ClickHouse Map(String, String) where all values are strings.
 */
function coerceToNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);

    return Number.isFinite(number) ? number : null;
  }

  return null;
}

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

  const rawCost = computeSpanCost({
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
 * The span's type as the read shape declares it. Canonicalisers only overwrite an allowed
 * `langwatch.span.type`, so a span sent with another one (`embedding`, `retriever`) is stored
 * with it. Such a span reads as `span`; the stored value stays in `params`.
 */
function readableSpanType(value: unknown): SpanTypes {
  const parsed = spanTypesSchema.safeParse(value);

  return parsed.success ? parsed.data : "span";
}

/**
 * Ingest stores span IO as sent, so chat values can carry what the strict shape refuses (AI SDK
 * `step-start` parts, `tool_use` blocks, a `model` role). The previous release returned them
 * unparsed; such a value now keeps its stored value under the `json` type.
 */
function toReadableSpanIo(io: LegacySpanInputOutput): LegacySpanInputOutput {
  const stored: unknown = io;
  if (legacySpanInputOutputSchema.validate(stored)) {
    return io;
  }

  return { type: "json", value: (io.value as JsonValue | undefined) ?? null };
}

type JsonValue = Extract<LegacySpanInputOutput, { type: "json" }>["value"];

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

  const input = extractInput(normalizedSpan.spanAttributes);
  const output = extractOutput(normalizedSpan.spanAttributes);

  const baseSpan: BaseSpan = {
    span_id: normalizedSpan.spanId,
    parent_id: normalizedSpan.parentSpanId,
    trace_id: normalizedSpan.traceId,
    type: readableSpanType(normalizedSpan.spanAttributes["langwatch.span.type"]),
    name: normalizedSpan.name,
    input: input === null ? null : toReadableSpanIo(input),
    output: output === null ? null : toReadableSpanIo(output),
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
