import { ATTR_KEYS, NON_BILLABLE_ATTR } from "@langwatch/span-normalisation";
import { z } from "zod";

import type { NormalizedSpan } from "../../trace.spans.ts";
import type { TraceSummaryData } from "../ingest/trace-projection.ts";

const numericValueSchema = z.union([
  z.number().finite(),
  z.string().trim().min(1).transform(Number).pipe(z.number().finite()),
]);

const langWatchTimestampsSchema = z.object({ first_token_at: z.unknown() });

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

export interface SpanTokenCounts {
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

export interface SpanCacheTokens {
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
}

export interface SpanTokenTiming {
  timeToFirstToken: number | null;
  timeToLastToken: number | null;
}

/** The running trace totals one span's tokens fold into. */
export type SpanTokenAccumulationState = Pick<
  TraceSummaryData,
  | "totalPromptTokenCount"
  | "totalCompletionTokenCount"
  | "totalCost"
  | "nonBilledCost"
  | "tokensEstimated"
  | "timeToFirstTokenMs"
  | "timeToLastTokenMs"
>;

export interface SpanTokenAccumulation {
  totalPromptTokenCount: number | null;
  totalCompletionTokenCount: number | null;
  totalCost: number | null;
  nonBilledCost: number | null;
  tokensEstimated: boolean;
  timeToFirstTokenMs: number | null;
  timeToLastTokenMs: number | null;
  tokensPerSecond: number | null;
}

function coerceToNumber(value: unknown): number | null {
  const parsed = numericValueSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/** Bundled-usage and skip markers accept a boolean or its string form. */
function markerIsTrue(value: unknown): boolean {
  return value === true || value === "true";
}

/** Response model, then request model; empty strings dropped. */
export function extractSpanModels(span: NormalizedSpan): string[] {
  return [
    span.spanAttributes[ATTR_KEYS.GEN_AI_RESPONSE_MODEL],
    span.spanAttributes[ATTR_KEYS.GEN_AI_REQUEST_MODEL],
  ].filter((m): m is string => typeof m === "string" && m !== "");
}

/**
 * Prompt and completion counts. Both semconv counts present means exact, so
 * `langwatch.tokens.estimated` is honoured only when one of them is missing.
 */
export function extractSpanTokenCounts(span: NormalizedSpan): SpanTokenCounts {
  const attrs = span.spanAttributes;
  const inputTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS];
  const outputTokens = attrs[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS];
  const hasFullSemconv =
    coerceToNumber(inputTokens) !== null && coerceToNumber(outputTokens) !== null;

  return {
    promptTokens: Math.max(0, coerceToNumber(inputTokens) ?? 0),
    completionTokens: Math.max(0, coerceToNumber(outputTokens) ?? 0),
    estimated:
      !hasFullSemconv &&
      (attrs[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED] === true ||
        attrs[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED] === "true"),
  };
}

/** Per-span cache and reasoning token counts, the first positive of each key list. */
export function extractSpanCacheTokens(span: NormalizedSpan): SpanCacheTokens {
  const attrs = span.spanAttributes;
  const firstPositive = (...keys: string[]): number => {
    for (const key of keys) {
      const n = coerceToNumber(attrs[key]);
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

/** A span-level bundled marker wins over the resource-level default. */
export function isSpanCostNonBillable(span: NormalizedSpan): boolean {
  const spanLevel = span.spanAttributes[NON_BILLABLE_ATTR];
  if (spanLevel !== undefined) {
    return markerIsTrue(spanLevel);
  }

  return markerIsTrue(span.resourceAttributes[NON_BILLABLE_ATTR]);
}

/** A redundant usage copy (e.g. codex's echo span) is excluded from trace totals. */
export function isSpanTokenAccumulationSkipped(span: NormalizedSpan): boolean {
  return markerIsTrue(span.spanAttributes[ATTR_KEYS.LANGWATCH_RESERVED_SKIP_TOKEN_ACCUMULATION]);
}

/** What a price lookup reads from a span: its attributes, first model and token counts. */
export interface SpanPriceInput {
  attributes: NormalizedSpan["spanAttributes"];
  model: string | undefined;
  promptTokens: number | null;
  completionTokens: number | null;
}

/** The input a model price table prices a span from; the caller owns the table. */
export function deriveSpanPriceInput(span: NormalizedSpan): SpanPriceInput {
  const { promptTokens, completionTokens } = extractSpanTokenCounts(span);

  return {
    attributes: span.spanAttributes,
    model: extractSpanModels(span)[0],
    promptTokens,
    completionTokens,
  };
}

/** The span's stored cost and bundled portion, given its already-priced `spanCost`. */
export function deriveSpanStorageCost({
  span,
  spanCost,
}: {
  span: NormalizedSpan;
  spanCost: number;
}): { cost: number | null; nonBilledCost: number | null } {
  if (spanCost <= 0) {
    return { cost: null, nonBilledCost: null };
  }

  const cost = Number(spanCost.toFixed(6));

  return { cost, nonBilledCost: isSpanCostNonBillable(span) ? cost : null };
}

function timingFromEvents(span: NormalizedSpan): SpanTokenTiming {
  let timeToFirstToken: number | null = null;
  let timeToLastToken: number | null = null;

  for (const event of span.events ?? []) {
    const delta = event.timeUnixMs - span.startTimeUnixMs;
    if (delta < 0) {
      continue;
    }

    const isEarlierFirst =
      FIRST_TOKEN_EVENTS.has(event.name) && (timeToFirstToken === null || delta < timeToFirstToken);
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

/** An offset or instant read from attributes, or the explicit absence of one. */
type AttributeReading = { kind: "read"; ms: number } | { kind: "absent" };

const ABSENT: AttributeReading = { kind: "absent" };

/** `langwatch.timestamps.first_token_at` (unix ms), from a parsed object or a raw JSON string. */
function readFirstTokenAtFromLangWatchTimestamps(value: unknown): AttributeReading {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return ABSENT;
    }
  }

  const object = langWatchTimestampsSchema.safeParse(parsed);
  if (!object.success) {
    return ABSENT;
  }

  const firstTokenAt = coerceToNumber(object.data.first_token_at);

  return firstTokenAt !== null && firstTokenAt > 0 ? { kind: "read", ms: firstTokenAt } : ABSENT;
}

/**
 * Without a stream event: the semconv attribute, the Vercel AI SDK duration,
 * then the LangWatch timestamps.
 */
function readTimeToFirstTokenFromAttributes(span: NormalizedSpan): AttributeReading {
  const attrTtft = coerceToNumber(span.spanAttributes[ATTR_KEYS.GEN_AI_SERVER_TIME_TO_FIRST_TOKEN]);
  if (attrTtft !== null && attrTtft >= 0) {
    return { kind: "read", ms: attrTtft };
  }

  const msToFirstChunk = coerceToNumber(
    span.spanAttributes[ATTR_KEYS.AI_RESPONSE_MS_TO_FIRST_CHUNK],
  );
  if (msToFirstChunk !== null && msToFirstChunk >= 0) {
    return { kind: "read", ms: msToFirstChunk };
  }

  const firstTokenAt = readFirstTokenAtFromLangWatchTimestamps(
    span.spanAttributes[ATTR_KEYS.LANGWATCH_TIMESTAMPS],
  );
  if (firstTokenAt.kind === "absent") {
    return ABSENT;
  }

  const delta = firstTokenAt.ms - span.startTimeUnixMs;

  return delta >= 0 ? { kind: "read", ms: delta } : ABSENT;
}

export function extractSpanTokenTiming(span: NormalizedSpan): SpanTokenTiming {
  const { timeToFirstToken, timeToLastToken } = timingFromEvents(span);
  if (timeToFirstToken !== null) {
    return { timeToFirstToken, timeToLastToken };
  }

  const fromAttributes = readTimeToFirstTokenFromAttributes(span);

  return {
    timeToFirstToken: fromAttributes.kind === "read" ? fromAttributes.ms : null,
    timeToLastToken,
  };
}

/**
 * Fold one span's tokens, cost and token timing into trace totals. `spanCost`
 * is the span's price, looked up by the caller; a skipped span adds nothing.
 */
export function accumulateSpanTokens({
  state,
  span,
  spanCost,
  totalDurationMs,
}: {
  state: SpanTokenAccumulationState;
  span: NormalizedSpan;
  spanCost: number;
  totalDurationMs: number;
}): SpanTokenAccumulation {
  const metrics = isSpanTokenAccumulationSkipped(span)
    ? { promptTokens: 0, completionTokens: 0, cost: 0, estimated: false }
    : { ...extractSpanTokenCounts(span), cost: spanCost };
  const totalPromptTokenCount = (state.totalPromptTokenCount ?? 0) + metrics.promptTokens;
  const totalCompletionTokenCount =
    (state.totalCompletionTokenCount ?? 0) + metrics.completionTokens;
  const totalCost = (state.totalCost ?? 0) + metrics.cost;
  const nonBilledCost =
    (state.nonBilledCost ?? 0) + (isSpanCostNonBillable(span) ? metrics.cost : 0);

  const timing = extractSpanTokenTiming(span);
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
