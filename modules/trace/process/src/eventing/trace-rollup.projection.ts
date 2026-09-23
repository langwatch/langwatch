import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import { Temporal, type Instant } from "@langwatch/time";
import {
  ATTR_KEYS,
  type SpanReceivedEvent,
  spanReceivedEventSchema,
  NormalizedStatusCode,
} from "@langwatch/trace-contract";

import { type TraceSpanNormalization } from "../app/trace.members.ts";
import type { SpanCostService } from "../services/span-cost.service.ts";

/**
 * One row emitted to `trace_analytics_rollup` per SpanReceivedEvent. Field
 * names match ClickHouse columns exactly (PascalCase) for `JSONEachRow`
 * with no second mapping layer. `BucketStart` floors to the minute.
 */
export interface TraceAnalyticsRollupRow {
  /** Project id; multitenancy boundary. Always required. */
  tenantId: string;
  /** Minute bucket of the span's startTimeUnixMs (toStartOfMinute). */
  bucketStart: Instant;
  /** Response model > request model > '', via SpanCostService.extractModelsFromSpan.
   *  This is a SORT key, not a group-by target — the rollup attributes each
   *  span's cost to that span's own model, whereas legacy and the slim table
   *  attribute a trace's whole cost to every model it used. See
   *  `routing/route-table.ts` → ROLLUP_TRACE_GROUP_BY_KEYS. */
  model: string;
  /** langwatch.span.type ('' when absent). */
  spanType: string;
  /** Always 1 (one row per span). */
  spanCount: number;
  /** 1 on the root span, 0 on the rest — `sum(TraceCount)` = traces in the
   *  bucket, the per-trace-average denominator. */
  traceCount: number;
  /** 1 when this is an erroring root span, else 0. */
  errorCount: number;
  /** Per-span cost (USD). */
  costSum: number;
  /** Bundled-portion cost (USD). */
  nonBilledCostSum: number;
  /** Root carries trace wall-clock duration, others carry 0. */
  durationSum: number;
  promptTokensSum: number;
  completionTokensSum: number;
  cacheReadTokensSum: number;
  cacheWriteTokensSum: number;
  reasoningTokensSum: number;
}

const spanEvents = [spanReceivedEventSchema] as const;

/** Floor a unix-ms timestamp to the minute boundary (toStartOfMinute equivalent). */
function toStartOfMinute(unixMs: number): Instant {
  return Temporal.Instant.fromEpochMilliseconds(Math.floor(unixMs / 60_000) * 60_000);
}

// Map projection that transforms SpanReceivedEvents into per-span rollup rows for
// `trace_analytics_rollup` (ADR-034 Phase 1); replaces interim MV approach, uses same keys so
// span's rollup contribution matches its contribution to trace total. Idempotent via replay.
export class TraceAnalyticsRollupMapProjection
  extends AbstractMapProjection<TraceAnalyticsRollupRow, typeof spanEvents>
  implements MapEventHandlers<typeof spanEvents, TraceAnalyticsRollupRow>
{
  readonly name = "traceAnalyticsRollup";
  readonly store: AppendStore<TraceAnalyticsRollupRow>;
  private readonly spanCostService: SpanCostService;
  private readonly spanNormalization: TraceSpanNormalization;
  protected readonly events = spanEvents;

  override options = {
    // Per-span parallelism — rollup rows are independent of each other and of
    // sibling spans on the same trace (the rollup is dim-keyed, not trace-keyed).
    groupKeyFn: (event: { id: string }) => `rollup:${event.id}`,
  };

  private constructor(deps: {
    store: AppendStore<TraceAnalyticsRollupRow>;
    spanCostService: SpanCostService;
    spanNormalization: TraceSpanNormalization;
  }) {
    super();
    this.store = deps.store;
    this.spanCostService = deps.spanCostService;
    this.spanNormalization = deps.spanNormalization;
  }

  static create(deps: {
    store: AppendStore<TraceAnalyticsRollupRow>;
    spanCostService: SpanCostService;
    spanNormalization: TraceSpanNormalization;
  }): TraceAnalyticsRollupMapProjection {
    return new TraceAnalyticsRollupMapProjection(deps);
  }

  mapTraceSpanReceived(event: SpanReceivedEvent): TraceAnalyticsRollupRow {
    // Normalize the same way the trace-summary fold + spanStorage projection do,
    // so the rollup contribution matches the trace total to the cent. Reusing
    // the pipeline service guarantees we never drift from the canonical
    // SpanAttributes shape the fold reads.
    const span = this.spanNormalization.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
    this.spanNormalization.enrichRagContextIds(span);

    const isRoot = span.parentSpanId === null;
    const isError = isRoot && span.statusCode === NormalizedStatusCode.ERROR;

    // Delegate every extraction to SpanCostService — the SAME calls
    // `SpanCostService.accumulateTokens` and the two folds make. Re-deriving
    // any of this from raw attribute reads silently drifts the rollup away
    // from `trace_summaries`, and the rollup only exists to answer the same
    // question faster.
    const model = this.spanCostService.extractModelsFromSpan(span)[0] ?? "";
    const spanType = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];

    // A redundant usage-copy span (e.g. codex's lower-level echo of the turn
    // rollup) contributes nothing to TRACE totals — the rollup is a
    // trace-level aggregate too, so it applies the same zeroing gate.
    const skipTokenAccumulation = this.spanCostService.isTokenAccumulationSkipped(span);
    const tokens = skipTokenAccumulation
      ? { promptTokens: 0, completionTokens: 0, cost: 0 }
      : this.spanCostService.extractTokenMetrics(span);
    const cacheTokens = skipTokenAccumulation
      ? { cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 }
      : this.spanCostService.extractCacheTokens(span);

    return {
      tenantId: span.tenantId,
      bucketStart: toStartOfMinute(span.startTimeUnixMs),
      model,
      spanType: typeof spanType === "string" ? spanType : "",
      spanCount: 1,
      traceCount: isRoot ? 1 : 0,
      errorCount: isError ? 1 : 0,
      costSum: tokens.cost,
      // Mirrors `accumulateTokens`: the bundled portion is this span's own cost
      // when the span is non-billable, and 0 otherwise. Skipped spans carry
      // cost 0, so they contribute nothing here either.
      nonBilledCostSum: this.spanCostService.isSpanCostNonBillable(span) ? tokens.cost : 0,
      // Root span carries trace wall-clock duration; children contribute 0 so the
      // SimpleAggregateFunction(sum) over a trace's spans equals the trace's
      // duration. (Same gate the prior MV applied via `ParentSpanId IS NULL`.)
      durationSum: isRoot ? Math.round(span.durationMs) : 0,
      promptTokensSum: tokens.promptTokens,
      completionTokensSum: tokens.completionTokens,
      cacheReadTokensSum: cacheTokens.cacheReadTokens,
      cacheWriteTokensSum: cacheTokens.cacheCreationTokens,
      reasoningTokensSum: cacheTokens.reasoningTokens,
    };
  }
}
