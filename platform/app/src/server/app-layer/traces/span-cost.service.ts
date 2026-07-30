import { coerceToNumber } from "~/utils/coerceToNumber";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import type { NormalizedSpan } from "./ingest/normalizedSpan";
import { computeSpanCost } from "./model-cost-matching";

const FIRST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "llm.content.completion.chunk",
  "first_token",
  "llm.first_token",
  "ai.stream.firstChunk",
  "First Token Stream Event",
]);

const LAST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "llm.content.completion.chunk",
  "last_token",
  "llm.last_token",
  "ai.stream.finish",
]);

/**
 * Marks LLM usage covered by a flat subscription rather than billed per token.
 * A span-level value overrides the resource-level default the receiver stamps,
 * so one trace can mix billed and bundled spans.
 */
const NON_BILLABLE_ATTR = ATTR_KEYS.LANGWATCH_COST_NON_BILLABLE;

function markerIsTrue(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * LangWatch SDKs report timing via `langwatch.timestamps`
 * (`{ started_at, first_token_at, finished_at }` in unix ms) rather than stream
 * events. The receiver parses JSON-string attributes, but an oversized value
 * skips parsing, so both shapes have to be accepted.
 */
function firstTokenAtFromLangWatchTimestamps(value: unknown): number | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const firstTokenAt = coerceToNumber(
    (parsed as Record<string, unknown>).first_token_at,
  );
  return firstTokenAt !== null && firstTokenAt > 0 ? firstTokenAt : null;
}

/** Per-span cost, token counts and token timing, read off a normalized span. */
export class SpanCostService {
  extractModelsFromSpan(span: NormalizedSpan): string[] {
    return [
      span.spanAttributes[ATTR_KEYS.GEN_AI_RESPONSE_MODEL],
      span.spanAttributes[ATTR_KEYS.GEN_AI_REQUEST_MODEL],
    ].filter((m): m is string => typeof m === "string" && m !== "");
  }

  extractTokenMetrics(span: NormalizedSpan): {
    promptTokens: number;
    completionTokens: number;
    cost: number;
    estimated: boolean;
  } {
    const attrs = span.spanAttributes;
    const inputTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS];
    const outputTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS];
    const promptTokens = Math.max(0, coerceToNumber(inputTokens) ?? 0);
    const completionTokens = Math.max(0, coerceToNumber(outputTokens) ?? 0);

    // Both semconv counts present means the values are authoritative, so the UI
    // must not also apologise with an "estimated" caveat. The
    // `langwatch.tokens.estimated` flag only counts when one was missing and
    // the number was derived elsewhere.
    const hasFullSemconv =
      coerceToNumber(inputTokens) !== null &&
      coerceToNumber(outputTokens) !== null;

    return {
      promptTokens,
      completionTokens,
      cost: computeSpanCost({
        attrs,
        model: this.extractModelsFromSpan(span)[0],
        promptTokens,
        completionTokens,
      }),
      estimated:
        !hasFullSemconv &&
        (attrs[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED] === true ||
          attrs[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED] === "true"),
    };
  }

  /**
   * Summed across a trace's spans by the fold, because for Anthropic the cache
   * write is always zero on the last span.
   */
  extractCacheTokens(span: NormalizedSpan): {
    cacheReadTokens: number;
    cacheCreationTokens: number;
    reasoningTokens: number;
  } {
    const attrs = span.spanAttributes;
    const firstPositive = (...keys: string[]): number => {
      for (const key of keys) {
        const n = coerceToNumber(attrs[key]);
        if (n !== null && n > 0) return n;
      }
      return 0;
    };
    return {
      cacheReadTokens: firstPositive(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        "gen_ai.usage.cached_tokens",
      ),
      cacheCreationTokens: firstPositive(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
      ),
      reasoningTokens: firstPositive(ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS),
    };
  }

  isSpanCostNonBillable(span: NormalizedSpan): boolean {
    const spanLevel = span.spanAttributes[NON_BILLABLE_ATTR];
    if (spanLevel !== undefined) return markerIsTrue(spanLevel);
    return markerIsTrue(span.resourceAttributes[NON_BILLABLE_ATTR]);
  }

  /**
   * Set by an extractor when an emitter reports the same usage on two spans
   * (codex's response span repeats the turn rollup's counts). Only trace-level
   * accumulation skips it; the per-span detail is untouched.
   */
  isTokenAccumulationSkipped(span: NormalizedSpan): boolean {
    return markerIsTrue(
      span.spanAttributes[ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION],
    );
  }

  extractTokenTiming(span: NormalizedSpan): {
    timeToFirstToken: number | null;
    timeToLastToken: number | null;
  } {
    let timeToFirstToken: number | null = null;
    let timeToLastToken: number | null = null;

    for (const event of span.events ?? []) {
      const delta = event.timeUnixMs - span.startTimeUnixMs;
      if (delta < 0) continue;
      if (
        FIRST_TOKEN_EVENTS.has(event.name) &&
        (timeToFirstToken === null || delta < timeToFirstToken)
      ) {
        timeToFirstToken = delta;
      }
      if (
        LAST_TOKEN_EVENTS.has(event.name) &&
        (timeToLastToken === null || delta > timeToLastToken)
      ) {
        timeToLastToken = delta;
      }
    }

    if (timeToFirstToken === null) {
      const attrTtft = coerceToNumber(
        span.spanAttributes[ATTR_KEYS.GEN_AI_SERVER_TIME_TO_FIRST_TOKEN],
      );
      if (attrTtft !== null && attrTtft >= 0) {
        timeToFirstToken = attrTtft;
      }
    }

    if (timeToFirstToken === null) {
      // The Vercel AI SDK reports TTFT as a duration attribute and emits no
      // stream event, so it needs its own fallback.
      const msToFirstChunk = coerceToNumber(
        span.spanAttributes[ATTR_KEYS.AI_RESPONSE_MS_TO_FIRST_CHUNK],
      );
      if (msToFirstChunk !== null && msToFirstChunk >= 0) {
        timeToFirstToken = msToFirstChunk;
      }
    }

    if (timeToFirstToken === null) {
      const firstTokenAt = firstTokenAtFromLangWatchTimestamps(
        span.spanAttributes[ATTR_KEYS.LANGWATCH_TIMESTAMPS],
      );
      if (firstTokenAt !== null) {
        const delta = firstTokenAt - span.startTimeUnixMs;
        if (delta >= 0) {
          timeToFirstToken = delta;
        }
      }
    }

    return { timeToFirstToken, timeToLastToken };
  }
}
