import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import { computeSpanCost } from "~/server/app-layer/traces/model-cost-matching";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { coerceToNumber } from "~/utils/coerceToNumber";
import type { NormalizedSpan } from "../../schemas/spans";

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
 * Marker stamped by the receiver (resource-level) on traces whose LLM usage
 * is covered by a flat subscription rather than billed per token, or set
 * directly on a span by an extractor or instrumentation that knows a single
 * call is bundled (the codex account provider's spans, for example). A
 * span-level value overrides the resource-level default, so a trace can mix
 * billed and bundled spans.
 */
export const NON_BILLABLE_ATTR = ATTR_KEYS.LANGWATCH_COST_NON_BILLABLE;

const CONDITIONAL_CANDIDATE_TOTALS_ATTR =
  ATTR_KEYS.LANGWATCH_RESERVED_TOKEN_ACCUMULATION_CANDIDATE_TOTALS;
const CONDITIONAL_AUTHORITY_TOTALS_ATTR =
  ATTR_KEYS.LANGWATCH_RESERVED_TOKEN_ACCUMULATION_AUTHORITY_TOTALS;
const RESERVED_CACHE_READ_TOKENS = "langwatch.reserved.cache_read_tokens";
const RESERVED_CACHE_CREATION_TOKENS =
  "langwatch.reserved.cache_creation_tokens";
const RESERVED_REASONING_TOKENS = "langwatch.reserved.reasoning_tokens";

interface ConditionalUsageTotals {
  isObserved: boolean;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  nonBilledCost: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
}

const EMPTY_CONDITIONAL_USAGE_TOTALS: ConditionalUsageTotals = {
  isObserved: false,
  promptTokens: 0,
  completionTokens: 0,
  cost: 0,
  nonBilledCost: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  reasoningTokens: 0,
};

function markerIsTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function conditionalUsageRole(span: NormalizedSpan): {
  isCandidate: boolean;
  isAuthority: boolean;
} {
  return {
    isCandidate: markerIsTrue(
      span.spanAttributes[
        ATTR_KEYS.LANGWATCH_RESERVED_TOKEN_ACCUMULATION_CANDIDATE
      ],
    ),
    isAuthority: markerIsTrue(
      span.spanAttributes[
        ATTR_KEYS.LANGWATCH_RESERVED_TOKEN_ACCUMULATION_AUTHORITY
      ],
    ),
  };
}

function parseConditionalUsageTotals(
  value: string | undefined,
): ConditionalUsageTotals {
  if (!value) return { ...EMPTY_CONDITIONAL_USAGE_TOTALS };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const number = (key: keyof ConditionalUsageTotals): number => {
      const candidate = parsed[key];
      return typeof candidate === "number" && Number.isFinite(candidate)
        ? Math.max(0, candidate)
        : 0;
    };
    return {
      isObserved: parsed.isObserved === true,
      promptTokens: number("promptTokens"),
      completionTokens: number("completionTokens"),
      cost: number("cost"),
      nonBilledCost: number("nonBilledCost"),
      cacheReadTokens: number("cacheReadTokens"),
      cacheCreationTokens: number("cacheCreationTokens"),
      reasoningTokens: number("reasoningTokens"),
    };
  } catch {
    return { ...EMPTY_CONDITIONAL_USAGE_TOTALS };
  }
}

function addNullableTotal(
  total: number | null,
  contribution: number,
  precision?: number,
): number | null {
  const resolved = (total ?? 0) + contribution;
  if (resolved <= Number.EPSILON) return null;
  return precision === undefined ? resolved : Number(resolved.toFixed(precision));
}

function applyReservedTotalDelta(
  attributes: Record<string, string>,
  key: string,
  delta: number,
): void {
  const parsedPrior = Number(attributes[key] ?? "0");
  const prior = Number.isFinite(parsedPrior) ? parsedPrior : 0;
  const resolved = prior + delta;
  if (resolved <= Number.EPSILON) {
    delete attributes[key];
    return;
  }
  attributes[key] = String(resolved);
}

function addConditionalUsageTotals(
  totals: ConditionalUsageTotals,
  contribution: ConditionalUsageTotals,
): ConditionalUsageTotals {
  return {
    isObserved: true,
    promptTokens: totals.promptTokens + contribution.promptTokens,
    completionTokens: totals.completionTokens + contribution.completionTokens,
    cost: totals.cost + contribution.cost,
    nonBilledCost: totals.nonBilledCost + contribution.nonBilledCost,
    cacheReadTokens: totals.cacheReadTokens + contribution.cacheReadTokens,
    cacheCreationTokens:
      totals.cacheCreationTokens + contribution.cacheCreationTokens,
    reasoningTokens: totals.reasoningTokens + contribution.reasoningTokens,
  };
}

function selectConditionalUsageTotals(
  candidate: ConditionalUsageTotals,
  authority: ConditionalUsageTotals,
): ConditionalUsageTotals {
  return authority.isObserved ? authority : candidate;
}

function subtractConditionalUsageTotals(
  minuend: ConditionalUsageTotals,
  subtrahend: ConditionalUsageTotals,
): ConditionalUsageTotals {
  return {
    isObserved: minuend.isObserved,
    promptTokens: minuend.promptTokens - subtrahend.promptTokens,
    completionTokens: minuend.completionTokens - subtrahend.completionTokens,
    cost: minuend.cost - subtrahend.cost,
    nonBilledCost: minuend.nonBilledCost - subtrahend.nonBilledCost,
    cacheReadTokens: minuend.cacheReadTokens - subtrahend.cacheReadTokens,
    cacheCreationTokens:
      minuend.cacheCreationTokens - subtrahend.cacheCreationTokens,
    reasoningTokens: minuend.reasoningTokens - subtrahend.reasoningTokens,
  };
}

function applyConditionalUsageAttributeDeltas(
  attributes: Record<string, string>,
  delta: ConditionalUsageTotals,
): void {
  applyReservedTotalDelta(
    attributes,
    RESERVED_CACHE_READ_TOKENS,
    delta.cacheReadTokens,
  );
  applyReservedTotalDelta(
    attributes,
    RESERVED_CACHE_CREATION_TOKENS,
    delta.cacheCreationTokens,
  );
  applyReservedTotalDelta(
    attributes,
    RESERVED_REASONING_TOKENS,
    delta.reasoningTokens,
  );
}

function projectConditionalUsageState(
  state: TraceSummaryData,
  attributes: Record<string, string>,
  delta: ConditionalUsageTotals,
): TraceSummaryData {
  return {
    ...state,
    attributes,
    totalPromptTokenCount: addNullableTotal(
      state.totalPromptTokenCount,
      delta.promptTokens,
    ),
    totalCompletionTokenCount: addNullableTotal(
      state.totalCompletionTokenCount,
      delta.completionTokens,
    ),
    totalCost: addNullableTotal(state.totalCost, delta.cost, 6),
    nonBilledCost: addNullableTotal(
      state.nonBilledCost,
      delta.nonBilledCost,
      6,
    ),
  };
}

function markTokenAccumulationSkipped(span: NormalizedSpan): NormalizedSpan {
  return {
    ...span,
    spanAttributes: {
      ...span.spanAttributes,
      [ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION]: "true",
    },
  };
}

/**
 * LangWatch SDKs export span timing via the `langwatch.timestamps`
 * attribute — { started_at, first_token_at, finished_at } in unix epoch
 * milliseconds — rather than stream events or semconv attributes. The
 * receiver parses JSON-string attribute values into objects, but a raw
 * string can still reach us (e.g. oversized blobs skip parsing), so
 * accept both shapes.
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

    // If both gen_ai semconv token counts are present, treat the values as
    // authoritative — we surface them as exact numbers so the UI shouldn't
    // also apologise with an "estimated" caveat. Only honour the
    // `langwatch.tokens.estimated` flag when one or both counts were missing
    // from the semconv attrs (and so were derived elsewhere).
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
   * Per-span cache + reasoning token counts, read from the same canonical
   * keys the drawer popover looks at. These are summed across the trace's
   * spans by the fold (the raw keys never reach the trace attribute map),
   * so "Cache write" and "Cache read" reflect the whole turn rather than
   * the last span — where, for Anthropic, the cache write is always zero.
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

  /**
   * Whether this span's cost is bundled (not billed per token). A span-level
   * marker wins over the resource-level default the receiver stamps, so a
   * single trace can carry a mix of billed and bundled spans.
   */
  isSpanCostNonBillable(span: NormalizedSpan): boolean {
    const spanLevel = span.spanAttributes[NON_BILLABLE_ATTR];
    if (spanLevel !== undefined) return markerIsTrue(spanLevel);
    return markerIsTrue(span.resourceAttributes[NON_BILLABLE_ATTR]);
  }

  /**
   * Whether this span's token usage is a redundant copy of another span's
   * and must be excluded from the trace-level token/cost/cache totals. An
   * extractor sets the marker when an emitter reports the same usage on two
   * spans (e.g. codex's lower-level response span repeats the turn rollup's
   * counts). The per-span detail is untouched — only the fold's
   * accumulation skips it, so the trace total counts the usage once.
   */
  isTokenAccumulationSkipped(span: NormalizedSpan): boolean {
    return markerIsTrue(
      span.spanAttributes[ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION],
    );
  }

  isConditionalTokenAccumulation(span: NormalizedSpan): boolean {
    if (this.isTokenAccumulationSkipped(span)) return false;
    const role = conditionalUsageRole(span);
    return role.isCandidate || role.isAuthority;
  }

  /**
   * Resolve usage that is only conditionally redundant across sibling spans.
   * Candidate and authority totals are tracked independently. The fold uses
   * one complete observed side at a time. Candidates remain countable until
   * any authority is observed, then the authority aggregate replaces them via
   * signed deltas. The stored span and its per-span detail remain unchanged.
   */
  resolveConditionalTokenAccumulation({
    state,
    span,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
  }): { state: TraceSummaryData; span: NormalizedSpan } {
    if (this.isTokenAccumulationSkipped(span)) return { state, span };

    const { isCandidate, isAuthority } = conditionalUsageRole(span);
    if (!isCandidate && !isAuthority) return { state, span };

    const attributes = { ...state.attributes };
    const candidateTotals = parseConditionalUsageTotals(
      attributes[CONDITIONAL_CANDIDATE_TOTALS_ATTR],
    );
    const authorityTotals = parseConditionalUsageTotals(
      attributes[CONDITIONAL_AUTHORITY_TOTALS_ATTR],
    );
    const previousApplied = selectConditionalUsageTotals(
      candidateTotals,
      authorityTotals,
    );
    const metrics = this.extractTokenMetrics(span);
    const cache = this.extractCacheTokens(span);
    const contribution: ConditionalUsageTotals = {
      isObserved: true,
      promptTokens: metrics.promptTokens,
      completionTokens: metrics.completionTokens,
      cost: metrics.cost,
      nonBilledCost: this.isSpanCostNonBillable(span) ? metrics.cost : 0,
      cacheReadTokens: cache.cacheReadTokens,
      cacheCreationTokens: cache.cacheCreationTokens,
      reasoningTokens: cache.reasoningTokens,
    };
    const nextCandidateTotals = isCandidate
      ? addConditionalUsageTotals(candidateTotals, contribution)
      : candidateTotals;
    const nextAuthorityTotals = isAuthority
      ? addConditionalUsageTotals(authorityTotals, contribution)
      : authorityTotals;
    attributes[CONDITIONAL_CANDIDATE_TOTALS_ATTR] =
      JSON.stringify(nextCandidateTotals);
    attributes[CONDITIONAL_AUTHORITY_TOTALS_ATTR] =
      JSON.stringify(nextAuthorityTotals);
    const delta = subtractConditionalUsageTotals(
      selectConditionalUsageTotals(nextCandidateTotals, nextAuthorityTotals),
      previousApplied,
    );
    applyConditionalUsageAttributeDeltas(attributes, delta);

    return {
      state: projectConditionalUsageState(state, attributes, delta),
      span: markTokenAccumulationSkipped(span),
    };
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
      // Vercel AI SDK reports TTFT as a duration attribute and emits no
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
    const totalPromptTokenCount =
      (state.totalPromptTokenCount ?? 0) + metrics.promptTokens;
    const totalCompletionTokenCount =
      (state.totalCompletionTokenCount ?? 0) + metrics.completionTokens;
    const totalCost = (state.totalCost ?? 0) + metrics.cost;
    // Bundled portion: only this span's cost when the span is non-billable.
    const nonBilledCost =
      (state.nonBilledCost ?? 0) +
      (this.isSpanCostNonBillable(span) ? metrics.cost : 0);

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
      nonBilledCost:
        nonBilledCost > 0 ? Number(nonBilledCost.toFixed(6)) : null,
      tokensEstimated: state.tokensEstimated || metrics.estimated,
      timeToFirstTokenMs,
      timeToLastTokenMs,
      tokensPerSecond,
    };
  }
}
