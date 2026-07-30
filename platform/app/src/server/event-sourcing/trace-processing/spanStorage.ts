import type { ClickHouseClient } from "@langwatch/clickhouse";
import { createMapExecutor, type AggregateEvent, type Metrics } from "@langwatch/event-sourcing";
import { trace } from "./aggregate";
import { createSpanStorageStore } from "./spanStorage.store";
import type { CanonicalSpan } from "./schema";

const SPAN_RECEIVED_TYPE = trace.eventType("spanReceived");

export const SPAN_STORAGE_PROJECTION_NAME = "spanStorage";

/**
 * The `spanStorage` map projection. Every span is stored regardless of
 * `traceSummary`'s processing cap — the no-drop half of
 * specs/trace-processing/oversized-trace-lighter-processing.feature.
 */
export function createSpanStorageProjection(args: {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
}): ReturnType<typeof createMapExecutor<AggregateEvent, CanonicalSpan>> {
  const store = createSpanStorageStore({ client: args.client });

  return createMapExecutor<AggregateEvent, CanonicalSpan>({
    store,
    map: (event) => (event.type === SPAN_RECEIVED_TYPE ? (event.data as CanonicalSpan) : null),
    projectionName: SPAN_STORAGE_PROJECTION_NAME,
    metrics: args.metrics,
  });
}
