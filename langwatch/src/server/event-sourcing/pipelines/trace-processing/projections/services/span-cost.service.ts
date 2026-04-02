import { coerceToNumber } from "~/utils/coerceToNumber";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import { computeSpanCost } from "~/server/app-layer/traces/model-cost-matching";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";

export const FIRST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "first_token",
  "llm.first_token",
  "llm.content.completion.chunk",
  "First Token Stream Event",
]);

export const LAST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "last_token",
  "llm.last_token",
  "llm.content.completion.chunk",
  "First Token Stream Event",
]);

/**
 * Computes per-span cost, token metrics, and token timing, then
 * accumulates them into trace-level totals.
 */
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
        attrs[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED] === true ||
        attrs[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED] === "true",
    };
  }

  extractTokenTiming(span: NormalizedSpan): {
    timeToFirstToken: number | null;
    timeToLastToken: number | null;
  } {
    let timeToFirstToken: number | null = null;
    let timeToLastToken: number | null = null;
    if (!span.events?.length) return { timeToFirstToken, timeToLastToken };

    for (const event of span.events) {
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

    return { timeToFirstToken, timeToLastToken };
  }

  accumulateTokens({
    state,
    span,
    totalDurationMs,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    totalDurationMs: number;
  }): {
    totalPromptTokenCount: number | null;
    totalCompletionTokenCount: number | null;
    totalCost: number | null;
    tokensEstimated: boolean;
    timeToFirstTokenMs: number | null;
    timeToLastTokenMs: number | null;
    tokensPerSecond: number | null;
  } {
    const metrics = this.extractTokenMetrics(span);
    const totalPromptTokenCount =
      (state.totalPromptTokenCount ?? 0) + metrics.promptTokens;
    const totalCompletionTokenCount =
      (state.totalCompletionTokenCount ?? 0) + metrics.completionTokens;
    const totalCost = (state.totalCost ?? 0) + metrics.cost;

    const timing = this.extractTokenTiming(span);
    let timeToFirstTokenMs = state.timeToFirstTokenMs;
    if (timing.timeToFirstToken !== null) {
      timeToFirstTokenMs =
        timeToFirstTokenMs === null
          ? timing.timeToFirstToken
          : Math.min(timeToFirstTokenMs, timing.timeToFirstToken);
    }
    let timeToLastTokenMs = state.timeToLastTokenMs;
    if (timing.timeToLastToken !== null) {
      timeToLastTokenMs =
        timeToLastTokenMs === null
          ? timing.timeToLastToken
          : Math.max(timeToLastTokenMs, timing.timeToLastToken);
    }

    const tokensPerSecond =
      totalCompletionTokenCount > 0 && totalDurationMs > 0
        ? Math.round((totalCompletionTokenCount / totalDurationMs) * 1000)
        : null;

    return {
      totalPromptTokenCount:
        totalPromptTokenCount > 0 ? totalPromptTokenCount : null,
      totalCompletionTokenCount:
        totalCompletionTokenCount > 0 ? totalCompletionTokenCount : null,
      totalCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
      tokensEstimated: state.tokensEstimated || metrics.estimated,
      timeToFirstTokenMs,
      timeToLastTokenMs,
      tokensPerSecond,
    };
  }
}
