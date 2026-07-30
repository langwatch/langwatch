import type { AggregateEvent } from "@langwatch/event-sourcing";
import type { CanonicalSpan } from "./schema";

/**
 * `traceAnalyticsRollup` — per-(bucket, model, spanType) span metrics, so a
 * dashboard query never scans raw spans. A fold whose aggregate is the rollup
 * BUCKET, not the trace: `map` + `AggregatingMergeTree` is closed to new
 * adopters because the engine cannot be made idempotent under redelivery
 * (ADR-099, ADR-106).
 */

export const TRACE_ANALYTICS_ROLLUP_PROJECTION_NAME = "traceAnalyticsRollup";

/** Floors to the minute — the bucket granularity. */
export function bucketStartMs(spanStartTimeUnixMs: number): number {
  return Math.floor(spanStartTimeUnixMs / 60_000) * 60_000;
}

/**
 * The rollup bucket's identity — this projection's "aggregate id"
 * (`groupKey.ts`'s `traceAnalyticsRollupFoldGroupKey` renders the same 3
 * parts, so the dispatch lane and the fold's own key can never disagree).
 */
export function rollupBucketKey(args: { readonly bucketStartMs: number; readonly model: string; readonly spanType: string }): string {
  return `${args.bucketStartMs}:${args.model}:${args.spanType}`;
}

export interface RollupState {
  readonly bucketStartMs: number;
  readonly model: string;
  readonly spanType: string;
  readonly spanCount: number;
  readonly traceCount: number;
  readonly errorCount: number;
  readonly costSum: number;
  readonly nonBilledCostSum: number;
  readonly durationSum: number;
  readonly promptTokensSum: number;
  readonly completionTokensSum: number;
  readonly cacheReadTokensSum: number;
  readonly cacheWriteTokensSum: number;
  readonly reasoningTokensSum: number;
}

export function initRollupState(): RollupState {
  return {
    bucketStartMs: 0,
    model: "",
    spanType: "",
    spanCount: 0,
    traceCount: 0,
    errorCount: 0,
    costSum: 0,
    nonBilledCostSum: 0,
    durationSum: 0,
    promptTokensSum: 0,
    completionTokensSum: 0,
    cacheReadTokensSum: 0,
    cacheWriteTokensSum: 0,
    reasoningTokensSum: 0,
  };
}

const UNMODELED = "unknown";
const UNTYPED = "unknown";

/**
 * Every field here is a plain sum: commutative and associative, but NOT
 * idempotent under redelivery. See this file's module docblock.
 */
export function handleSpanReceivedForRollup(state: RollupState, span: CanonicalSpan): RollupState {
  const isRoot = span.parentSpanId === null;
  const bucket = bucketStartMs(span.startTimeUnixMs);
  const model = span.model ?? UNMODELED;
  const spanType = span.attributes["langwatch.span.type"];
  const resolvedSpanType = typeof spanType === "string" && spanType ? spanType : UNTYPED;

  return {
    bucketStartMs: bucket,
    model,
    spanType: resolvedSpanType,
    spanCount: state.spanCount + 1,
    traceCount: state.traceCount + (isRoot ? 1 : 0),
    errorCount: state.errorCount + (isRoot && span.statusCode === "ERROR" ? 1 : 0),
    costSum: state.costSum + (span.cost.cost ?? 0),
    nonBilledCostSum: state.nonBilledCostSum + (span.cost.nonBilledCost ?? 0),
    durationSum: state.durationSum + (isRoot ? Math.max(0, span.endTimeUnixMs - span.startTimeUnixMs) : 0),
    promptTokensSum: state.promptTokensSum + (span.usage.inputTokens ?? 0),
    completionTokensSum: state.completionTokensSum + (span.usage.outputTokens ?? 0),
    cacheReadTokensSum: state.cacheReadTokensSum + (span.usage.cacheReadTokens ?? 0),
    cacheWriteTokensSum: state.cacheWriteTokensSum + (span.usage.cacheWriteTokens ?? 0),
    reasoningTokensSum: state.reasoningTokensSum + (span.usage.reasoningTokens ?? 0),
  };
}

export function applyRollup(state: RollupState, event: AggregateEvent): RollupState {
  if (event.type !== "trace/spanReceived") return state;
  return handleSpanReceivedForRollup(state, event.data as CanonicalSpan);
}
