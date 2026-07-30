import type { ClickHouseClient } from "@langwatch/clickhouse";
import { createFoldExecutor, deriveStateVersion, type AggregateEvent, type Metrics } from "@langwatch/event-sourcing";
import { createTraceAnalyticsStore } from "./traceAnalytics.store";
import { applyTraceAnalytics, TRACE_ANALYTICS_PROJECTION_NAME } from "./traceAnalytics";
import { traceAnalyticsStateSchema, initTraceAnalyticsState, type TraceAnalyticsState } from "./traceAnalytics.schema";

export const TRACE_ANALYTICS_STATE_VERSION = deriveStateVersion(traceAnalyticsStateSchema);

export function createTraceAnalyticsProjection(args: {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
}): ReturnType<typeof createFoldExecutor<TraceAnalyticsState, AggregateEvent>> {
  const store = createTraceAnalyticsStore({ client: args.client, expectedVersion: TRACE_ANALYTICS_STATE_VERSION });

  return createFoldExecutor<TraceAnalyticsState, AggregateEvent>({
    store,
    init: () => initTraceAnalyticsState(""),
    apply: applyTraceAnalytics,
    stateVersion: TRACE_ANALYTICS_STATE_VERSION,
    projectionName: TRACE_ANALYTICS_PROJECTION_NAME,
    metrics: args.metrics,
  });
}
