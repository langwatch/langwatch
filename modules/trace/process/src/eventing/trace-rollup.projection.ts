import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { Temporal, type Instant } from "@langwatch/time";
import {
  deriveSpanRollupContribution,
  isSpanTokenAccumulationSkipped,
  type SpanReceivedEvent,
  spanReceivedEventSchema,
  spanStorabilityOf,
  UNSTORABLE_SPAN_SKIPPED,
} from "@langwatch/trace-contract";

import type { SpanCostService } from "../features/span/services/span-cost.service.ts";
import type { TraceSpanNormalization } from "../features/span/services/span-normalization.service.ts";

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
  /** Response model > request model > '', via trace-contract's extractSpanModels.
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

const logger = createLogger("langwatch:trace-processing:trace-analytics-rollup-map");

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
    groupKeyFn: (event: { id: string }): string => `rollup:${event.id}`,
    onExhausted: "dead-letter" as const,
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

  mapTraceSpanReceived(event: SpanReceivedEvent): TraceAnalyticsRollupRow | null {
    // Same gate as the spanStorage projection, for the same reason: normalization
    // mints a KSUID over the span's start SECONDS and throws on a value the
    // 48-bit field cannot hold. It would also file the row's minute bucket
    // outside anything a read opens.
    const storability = spanStorabilityOf({ event, consumer: this.name });
    if (!storability.storable) {
      logger.warn(storability.skip, UNSTORABLE_SPAN_SKIPPED);
      return null;
    }

    // Normalize the same way the trace-summary fold + spanStorage projection do,
    // so the rollup contribution matches the trace total to the cent. Reusing
    // the pipeline service guarantees we never drift from the canonical
    // SpanAttributes shape the fold reads.
    const span = this.spanNormalization.normalizeSpanReceived({
      tenantId: event.tenantId,
      span: event.data.span,
      resource: event.data.resource,
      instrumentationScope: event.data.instrumentationScope,
    });
    this.spanNormalization.enrichRagContextIds(span);

    // Every extraction is trace-contract's, the SAME the trace-summary fold
    // makes, so the rollup cannot drift from `trace_summaries`. Only the
    // price lookup stays here; a skipped usage-copy span is never priced.
    const spanCost = isSpanTokenAccumulationSkipped(span)
      ? 0
      : this.spanCostService.estimateSpanCost(span);

    return {
      tenantId: span.tenantId,
      bucketStart: toStartOfMinute(span.startTimeUnixMs),
      ...deriveSpanRollupContribution({ span, spanCost }),
    };
  }
}
