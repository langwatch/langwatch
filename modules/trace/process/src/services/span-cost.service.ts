import { ATTR_KEYS, NON_BILLABLE_ATTR } from "@langwatch/trace-contract";
import type { TraceSummaryData, NormalizedSpan } from "@langwatch/trace-contract";
import { z } from "zod";

import { type TraceModelCost } from "../app/trace.members.ts";

const numericValueSchema = z.union([
  z.number().finite(),
  z.string().trim().min(1).transform(Number).pipe(z.number().finite()),
]);

const langWatchTimestampsSchema = z.object({ first_token_at: z.unknown() });

export const FIRST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "llm.content.completion.chunk",
  "first_token",
  "llm.first_token",
  "ai.stream.firstChunk",
  "First Token Stream Event",
]);

export const LAST_TOKEN_EVENTS = new Set([
  "gen_ai.content.chunk",
  "llm.content.completion.chunk",
  "last_token",
  "llm.last_token",
  "ai.stream.finish",
]);

/**
 * Computes per-span cost, token metrics, and token timing, then
 * accumulates them into trace-level totals.
 */
export class SpanCostService {
  private constructor(private readonly modelCosts: TraceModelCost) {}

  static create(options: { modelCosts: TraceModelCost }): SpanCostService {
    return new SpanCostService(options.modelCosts);
  }

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
    const promptTokens = Math.max(0, SpanCostService.coerceToNumber(inputTokens) ?? 0);
    const completionTokens = Math.max(0, SpanCostService.coerceToNumber(outputTokens) ?? 0);

    // If both gen_ai semconv token counts are present, treat the values as
    // authoritative — we surface them as exact numbers so the UI shouldn't
    // also apologise with an "estimated" caveat. Only honour the
    // `langwatch.tokens.estimated` flag when one or both counts were missing
    // from the semconv attrs (and so were derived elsewhere).
    const hasFullSemconv =
      SpanCostService.coerceToNumber(inputTokens) !== null &&
      SpanCostService.coerceToNumber(outputTokens) !== null;

    return {
      promptTokens,
      completionTokens,
      cost: this.modelCosts.estimate({
        attributes: attrs,
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
   * Per-span cache + reasoning token counts, read from the same keys the
   * drawer popover uses. Summed across spans by the fold, so "Cache
   * write/read" reflect the whole turn, not the last span (zero for Anthropic).
   */
  extractCacheTokens(span: NormalizedSpan): {
    cacheReadTokens: number;
    cacheCreationTokens: number;
    reasoningTokens: number;
  } {
    const attrs = span.spanAttributes;
    const firstPositive = (...keys: string[]): number => {
      for (const key of keys) {
        const n = SpanCostService.coerceToNumber(attrs[key]);
        if (n !== null && n > 0) {
          return n;
        }
      }

      return 0;
    };

    return {
      cacheReadTokens: firstPositive(
        ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        "gen_ai.usage.cached_tokens",
      ),
      cacheCreationTokens: firstPositive(ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS),
      reasoningTokens: firstPositive(ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS),
    };
  }

  /**
   * Whether this span's cost is bundled (not billed per token). A span-level
   * marker wins over the resource-level default the receiver stamps, so a
   * single trace can carry a mix of billed and bundled spans.
   */
  isSpanCostNonBillable(span: NormalizedSpan): boolean {
    const spanLevel = span.spanAttributes[NON_BILLABLE_ATTR];
    if (spanLevel !== undefined) {
      return SpanCostService.markerIsTrue(spanLevel);
    }

    return SpanCostService.markerIsTrue(span.resourceAttributes[NON_BILLABLE_ATTR]);
  }

  deriveStorageCost(span: NormalizedSpan): {
    cost: number | null;
    nonBilledCost: number | null;
  } {
    const rawCost = this.extractTokenMetrics(span).cost;
    if (rawCost <= 0) {
      return { cost: null, nonBilledCost: null };
    }

    const cost = Number(rawCost.toFixed(6));
    const nonBilledCost = this.isSpanCostNonBillable(span) ? cost : null;

    return { cost, nonBilledCost };
  }

  /**
   * Whether this span's token usage is a redundant copy of another's,
   * excluded from trace-level totals. An extractor sets the marker when an
   * emitter double-reports usage (e.g. codex's lower-level echo span).
   */
  isTokenAccumulationSkipped(span: NormalizedSpan): boolean {
    return SpanCostService.markerIsTrue(
      span.spanAttributes[ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION],
    );
  }

  /** The earliest first-token and latest last-token stream events, as offsets from span start. */
  #timingFromEvents(span: NormalizedSpan): {
    timeToFirstToken: number | null;
    timeToLastToken: number | null;
  } {
    let timeToFirstToken: number | null = null;
    let timeToLastToken: number | null = null;

    for (const event of span.events ?? []) {
      const delta = event.timeUnixMs - span.startTimeUnixMs;
      if (delta < 0) {
        continue;
      }

      const isEarlierFirst =
        FIRST_TOKEN_EVENTS.has(event.name) &&
        (timeToFirstToken === null || delta < timeToFirstToken);
      if (isEarlierFirst) {
        timeToFirstToken = delta;
      }

      const isLaterLast =
        LAST_TOKEN_EVENTS.has(event.name) && (timeToLastToken === null || delta > timeToLastToken);
      if (isLaterLast) {
        timeToLastToken = delta;
      }
    }

    return { timeToFirstToken, timeToLastToken };
  }

  /**
   * Time to first token when no stream event carried it: the semconv attribute, then the Vercel
   * AI SDK's own duration attribute (it emits no stream event), then the LangWatch timestamps.
   */
  #timeToFirstTokenFromAttributes(span: NormalizedSpan): number | null {
    const attrTtft = SpanCostService.coerceToNumber(
      span.spanAttributes[ATTR_KEYS.GEN_AI_SERVER_TIME_TO_FIRST_TOKEN],
    );
    if (attrTtft !== null && attrTtft >= 0) {
      return attrTtft;
    }

    const msToFirstChunk = SpanCostService.coerceToNumber(
      span.spanAttributes[ATTR_KEYS.AI_RESPONSE_MS_TO_FIRST_CHUNK],
    );
    if (msToFirstChunk !== null && msToFirstChunk >= 0) {
      return msToFirstChunk;
    }

    const firstTokenAt = SpanCostService.firstTokenAtFromLangWatchTimestamps(
      span.spanAttributes[ATTR_KEYS.LANGWATCH_TIMESTAMPS],
    );
    if (firstTokenAt === null) {
      return null;
    }

    const delta = firstTokenAt - span.startTimeUnixMs;

    return delta >= 0 ? delta : null;
  }

  extractTokenTiming(span: NormalizedSpan): {
    timeToFirstToken: number | null;
    timeToLastToken: number | null;
  } {
    const { timeToFirstToken, timeToLastToken } = this.#timingFromEvents(span);

    return {
      timeToFirstToken: timeToFirstToken ?? this.#timeToFirstTokenFromAttributes(span),
      timeToLastToken,
    };
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
    nonBilledCost: number | null;
    tokensEstimated: boolean;
    timeToFirstTokenMs: number | null;
    timeToLastTokenMs: number | null;
    tokensPerSecond: number | null;
  } {
    // A span flagged as a redundant usage copy (e.g. codex's lower-level
    // response span echoing the turn rollup) contributes nothing to the
    // trace totals, so its tokens/cost are counted exactly once.
    const metrics = this.isTokenAccumulationSkipped(span)
      ? { promptTokens: 0, completionTokens: 0, cost: 0, estimated: false }
      : this.extractTokenMetrics(span);
    const totalPromptTokenCount = (state.totalPromptTokenCount ?? 0) + metrics.promptTokens;
    const totalCompletionTokenCount =
      (state.totalCompletionTokenCount ?? 0) + metrics.completionTokens;
    const totalCost = (state.totalCost ?? 0) + metrics.cost;
    // Bundled portion: only this span's cost when the span is non-billable.
    const nonBilledCost =
      (state.nonBilledCost ?? 0) + (this.isSpanCostNonBillable(span) ? metrics.cost : 0);

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
      totalPromptTokenCount: totalPromptTokenCount > 0 ? totalPromptTokenCount : null,
      totalCompletionTokenCount: totalCompletionTokenCount > 0 ? totalCompletionTokenCount : null,
      totalCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
      nonBilledCost: nonBilledCost > 0 ? Number(nonBilledCost.toFixed(6)) : null,
      tokensEstimated: state.tokensEstimated || metrics.estimated,
      timeToFirstTokenMs,
      timeToLastTokenMs,
      tokensPerSecond,
    };
  }

  private static coerceToNumber(value: unknown): number | null {
    const parsed = numericValueSchema.safeParse(value);

    return parsed.success ? parsed.data : null;
  }

  /**
   * Marker for traces whose LLM usage is a flat subscription, not billed
   * per token (e.g. the codex account provider). A span-level value
   * overrides the resource-level default, mixing billed and bundled spans.
   */
  private static markerIsTrue(value: unknown): boolean {
    return value === true || value === "true";
  }

  /**
   * LangWatch SDKs export span timing via `langwatch.timestamps` (unix
   * epoch ms), not stream events or semconv. The receiver usually parses
   * it to an object, but a raw string can still arrive, so accept both.
   */
  private static firstTokenAtFromLangWatchTimestamps(value: unknown): number | null {
    let parsed: unknown = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        return null;
      }
    }

    const object = langWatchTimestampsSchema.safeParse(parsed);
    if (!object.success) {
      return null;
    }

    const firstTokenAt = SpanCostService.coerceToNumber(object.data.first_token_at);

    return firstTokenAt !== null && firstTokenAt > 0 ? firstTokenAt : null;
  }
}
