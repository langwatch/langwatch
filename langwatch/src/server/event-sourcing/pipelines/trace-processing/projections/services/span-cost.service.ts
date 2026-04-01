import { coerceToNumber } from "~/utils/coerceToNumber";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  estimateCost,
  matchModelCostWithFallbacks,
} from "~/server/background/workers/collector/cost";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import type { NormalizedAttributes, NormalizedSpan } from "../../schemas/spans";

export const FIRST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "first_token",
  "llm.first_token",
]);

export const LAST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "last_token",
  "llm.last_token",
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

  computeSpanCost({
    attrs,
    model,
    promptTokens,
    completionTokens,
  }: {
    attrs: NormalizedAttributes;
    model: string | undefined;
    promptTokens: number;
    completionTokens: number;
  }): number {
    const numInputRate = coerceToNumber(
      attrs[ATTR_KEYS.LANGWATCH_MODEL_INPUT_COST_PER_TOKEN],
    );
    const numOutputRate = coerceToNumber(
      attrs[ATTR_KEYS.LANGWATCH_MODEL_OUTPUT_COST_PER_TOKEN],
    );
    if (numInputRate !== null || numOutputRate !== null) {
      const derivedCost =
        promptTokens * (numInputRate ?? 0) +
        completionTokens * (numOutputRate ?? 0);
      if (derivedCost > 0) return derivedCost;
    }

    if (model && (promptTokens > 0 || completionTokens > 0)) {
      const matched = matchModelCostWithFallbacks(model, getStaticModelCosts());
      if (matched) {
        const computed = estimateCost({
          llmModelCost: matched,
          inputTokens: promptTokens,
          outputTokens: completionTokens,
        });
        if (computed !== undefined && computed > 0) return computed;
      }
    }

    const numSpanCost = coerceToNumber(attrs[ATTR_KEYS.LANGWATCH_SPAN_COST]);
    if (numSpanCost !== null && numSpanCost > 0) return numSpanCost;

    if (attrs[ATTR_KEYS.SPAN_TYPE] === "guardrail") {
      const rawOutput = attrs[ATTR_KEYS.LANGWATCH_OUTPUT];
      if (
        rawOutput &&
        typeof rawOutput === "object" &&
        !Array.isArray(rawOutput)
      ) {
        const costObj = (rawOutput as Record<string, unknown>).cost as
          | { amount?: number; currency?: string }
          | undefined;
        if (
          costObj?.currency === "USD" &&
          typeof costObj.amount === "number" &&
          costObj.amount > 0
        ) {
          return costObj.amount;
        }
      }
    }

    return 0;
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
      cost: this.computeSpanCost({
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
