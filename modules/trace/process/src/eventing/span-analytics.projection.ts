import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  type SpanReceivedEvent,
  spanReceivedEventSchema,
  spanStorabilityOf,
  UNSTORABLE_SPAN_SKIPPED,
} from "@langwatch/trace-contract";

import {
  spanStorageMapGroupKey,
  TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
} from "../features/span/rules/trace-span-storage-group.rules.ts";
import type { SpanCostService } from "../features/span/services/span-cost.service.ts";
import type { TraceSpanNormalization } from "../features/span/services/span-normalization.service.ts";
import { type SpanWidgetFacts, spanWidgetFacts } from "../rules/trace-widget-columns.rules.ts";

const logger = createLogger("langwatch:trace-processing:span-analytics-map");

const spanEvents = [spanReceivedEventSchema] as const;

/** The projection's name, which is also its replay lane (analytics ADR-006). */
export const SPAN_ANALYTICS_PROJECTION_NAME = "spanAnalytics";

/** One `span_analytics` row: the span facts the stock widgets read, and no map. */
export interface SpanAnalyticsRow extends SpanWidgetFacts {
  tenantId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  durationMs: number;
  spanName: string;
  spanKind: number;
  statusCode: number | null;
  cost: number | null;
  nonBilledCost: number | null;
}

/**
 * Map projection writing `span_analytics` from each SpanReceivedEvent: the span normalised,
 * enriched and priced exactly as the spanStorage projection stores it, so each fact equals the
 * `stored_spans` map lookup it replaces.
 */
export class SpanAnalyticsMapProjection
  extends AbstractMapProjection<SpanAnalyticsRow, typeof spanEvents>
  implements MapEventHandlers<typeof spanEvents, SpanAnalyticsRow>
{
  readonly name = SPAN_ANALYTICS_PROJECTION_NAME;
  readonly targetTable = "span_analytics";
  readonly store: AppendStore<SpanAnalyticsRow>;
  private readonly spanCostService: SpanCostService;
  private readonly spanNormalization: TraceSpanNormalization;
  protected readonly events = spanEvents;

  override options = {
    // The spanStorage lanes (ADR-066): same span, same lane, coalesced into bulk appends.
    groupKeyFn: spanStorageMapGroupKey,
    coalesceMaxBatch: TRACE_SPAN_MAP_COALESCE_MAX_BATCH,
    onExhausted: "dead-letter" as const,
  };

  private constructor(deps: {
    store: AppendStore<SpanAnalyticsRow>;
    spanCostService: SpanCostService;
    spanNormalization: TraceSpanNormalization;
  }) {
    super();
    this.store = deps.store;
    this.spanCostService = deps.spanCostService;
    this.spanNormalization = deps.spanNormalization;
  }

  static create(deps: {
    store: AppendStore<SpanAnalyticsRow>;
    spanCostService: SpanCostService;
    spanNormalization: TraceSpanNormalization;
  }): SpanAnalyticsMapProjection {
    return new SpanAnalyticsMapProjection(deps);
  }

  mapTraceSpanReceived(event: SpanReceivedEvent): SpanAnalyticsRow | null {
    // The spanStorage gate: a span it cannot store has no row here either.
    const storability = spanStorabilityOf({ event, consumer: this.name });
    if (!storability.storable) {
      logger.warn(storability.skip, UNSTORABLE_SPAN_SKIPPED);
      return null;
    }

    const span = this.spanNormalization.normalizeSpanReceived({
      tenantId: event.tenantId,
      span: event.data.span,
      resource: event.data.resource,
      instrumentationScope: event.data.instrumentationScope,
    });
    this.spanNormalization.enrichRagContextIds(span);
    const { cost, nonBilledCost } = this.spanCostService.deriveStorageCost(span);

    return {
      tenantId: span.tenantId,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      startTimeUnixMs: span.startTimeUnixMs,
      endTimeUnixMs: span.endTimeUnixMs,
      durationMs: span.durationMs,
      spanName: span.name,
      spanKind: span.kind,
      statusCode: span.statusCode,
      cost,
      nonBilledCost,
      ...spanWidgetFacts(span),
    };
  }
}
