import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import {
  enrichRagContextIds,
  SpanNormalizationPipelineService,
} from "~/server/app-layer/traces/span-normalization.service";
import { coerceToNumber } from "~/utils/coerceToNumber";
import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type SpanReceivedEvent,
  spanReceivedEventSchema,
} from "../schemas/events";
import { NormalizedStatusCode } from "../schemas/spans";
import { deriveSpanCost } from "./services/span-cost.derivation";
import { SpanCostService } from "./services/span-cost.service";

/**
 * One row emitted to `trace_analytics_rollup` per SpanReceivedEvent.
 *
 * Field names match the ClickHouse columns exactly (PascalCase) so the
 * repository hands the record to `JSONEachRow` without a second mapping
 * layer. `BucketStart` is a JS `Date` floored to the minute — the CH client
 * serializes it as a `DateTime64(3)` literal.
 */
export interface TraceAnalyticsRollupRow {
  /** Project id; multitenancy boundary. Always required. */
  tenantId: string;
  /** Minute bucket of the span's startTimeUnixMs (toStartOfMinute). */
  bucketStart: Date;
  /** Response model > request model > '' (mirrors SpanCostService.extractModelsFromSpan). */
  model: string;
  /** langwatch.span.type ('' when absent). */
  spanType: string;
  /** Always 1 (one row per span). */
  spanCount: number;
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

const spanNormalizationPipelineService = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

const spanCostService = new SpanCostService();

const spanEvents = [spanReceivedEventSchema] as const;

/** Floor a unix-ms timestamp to the minute boundary (toStartOfMinute equivalent). */
function toStartOfMinute(unixMs: number): Date {
  return new Date(Math.floor(unixMs / 60_000) * 60_000);
}

function toNonNegativeUInt(value: unknown): number {
  const n = coerceToNumber(value);
  if (n === null || !Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

/**
 * Map projection that transforms SpanReceivedEvents into per-span rollup rows
 * for `trace_analytics_rollup` (ADR-034, Phase 1).
 *
 * This projection replaces the prior MV approach (an interim materialized-view migration that was never deployed):
 * the same SpanReceivedEvent the trace-summary fold consumes is also the source
 * of the rollup increment, computed in TypeScript using the same
 * `SpanCostService` extraction keys so a span's rollup contribution matches its
 * contribution to the trace total.
 *
 * Idempotency / re-delivery: each insert is a separate row in the
 * AggregatingMergeTree; a rare retry over-counts the bucket by one span's
 * contribution. ADR-034 accepts that explicitly. Replay rebuilds the rollup
 * truncate-first rather than incrementing it.
 */
export class TraceAnalyticsRollupMapProjection
  extends AbstractMapProjection<TraceAnalyticsRollupRow, typeof spanEvents>
  implements MapEventHandlers<typeof spanEvents, TraceAnalyticsRollupRow>
{
  readonly name = "traceAnalyticsRollup";
  readonly store: AppendStore<TraceAnalyticsRollupRow>;
  protected readonly events = spanEvents;

  override options = {
    // Per-span parallelism — rollup rows are independent of each other and of
    // sibling spans on the same trace (the rollup is dim-keyed, not trace-keyed).
    groupKeyFn: (event: { id: string }) => `rollup:${event.id}`,
  };

  constructor(deps: { store: AppendStore<TraceAnalyticsRollupRow> }) {
    super();
    this.store = deps.store;
  }

  mapTraceSpanReceived(event: SpanReceivedEvent): TraceAnalyticsRollupRow {
    // Normalize the same way the trace-summary fold + spanStorage projection do,
    // so the rollup contribution matches the trace total to the cent. Reusing
    // the pipeline service guarantees we never drift from the canonical
    // SpanAttributes shape the fold reads.
    const span = spanNormalizationPipelineService.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
    enrichRagContextIds(span);
    const { cost, nonBilledCost } = deriveSpanCost({ span, spanCostService });
    span.cost = cost;
    span.nonBilledCost = nonBilledCost;

    const isRoot = span.parentSpanId === null;
    const isError = isRoot && span.statusCode === NormalizedStatusCode.ERROR;

    // Model precedence mirrors SpanCostService.extractModelsFromSpan: response
    // wins over request, fall back to '' for cardinality-friendly LowCardinality
    // bucketing.
    const responseModel = span.spanAttributes[ATTR_KEYS.GEN_AI_RESPONSE_MODEL];
    const requestModel = span.spanAttributes[ATTR_KEYS.GEN_AI_REQUEST_MODEL];
    const model =
      (typeof responseModel === "string" && responseModel !== ""
        ? responseModel
        : typeof requestModel === "string"
          ? requestModel
          : "") || "";

    const spanTypeRaw = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];
    const spanType = typeof spanTypeRaw === "string" ? spanTypeRaw : "";

    // Token keys mirror SpanCostService.extractTokenMetrics + extractCacheTokens.
    // Coerce-to-number tolerates Map(String,String) values from CH while staying
    // strict about non-numeric junk (becomes 0, not NaN).
    const promptTokensSum = toNonNegativeUInt(
      span.spanAttributes[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS],
    );
    const completionTokensSum = toNonNegativeUInt(
      span.spanAttributes[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS],
    );
    const cacheReadTokensSum = toNonNegativeUInt(
      span.spanAttributes[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
    );
    const cacheWriteTokensSum = toNonNegativeUInt(
      span.spanAttributes[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS],
    );
    const reasoningTokensSum = toNonNegativeUInt(
      span.spanAttributes[ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS],
    );

    return {
      tenantId: span.tenantId,
      bucketStart: toStartOfMinute(span.startTimeUnixMs),
      model,
      spanType,
      spanCount: 1,
      errorCount: isError ? 1 : 0,
      costSum: span.cost ?? 0,
      nonBilledCostSum: span.nonBilledCost ?? 0,
      // Root span carries trace wall-clock duration; children contribute 0 so the
      // SimpleAggregateFunction(sum) over a trace's spans equals the trace's
      // duration. (Same gate the prior MV applied via `ParentSpanId IS NULL`.)
      durationSum: isRoot ? Math.round(span.durationMs) : 0,
      promptTokensSum,
      completionTokensSum,
      cacheReadTokensSum,
      cacheWriteTokensSum,
      reasoningTokensSum,
    };
  }
}
