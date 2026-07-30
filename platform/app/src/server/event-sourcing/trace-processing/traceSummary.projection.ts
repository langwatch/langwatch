import type { ClickHouseClient } from "@langwatch/clickhouse";
import { createFoldExecutor, deriveStateVersion, type AggregateEvent, type Metrics } from "@langwatch/event-sourcing";
import { createTraceSummaryStore } from "./traceSummary.store";
import { applyTraceSummary, TRACE_SUMMARY_PROJECTION_NAME } from "./traceSummary";
import { traceSummaryStateSchema, initTraceSummaryState, type TraceSummaryState } from "./traceSummary.schema";

/**
 * Wires the `traceSummary` fold onto its ClickHouse store (ADR-098, ADR-105).
 * The mount itself — `fold` + `replace` + `scope: aggregate` — is asserted
 * legal in `mount.ts`, once for the whole pipeline.
 */

export const TRACE_SUMMARY_STATE_VERSION = deriveStateVersion(traceSummaryStateSchema);

export function createTraceSummaryProjection(args: {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
}): ReturnType<typeof createFoldExecutor<TraceSummaryState, AggregateEvent>> {
  const store = createTraceSummaryStore({ client: args.client, expectedVersion: TRACE_SUMMARY_STATE_VERSION });

  return createFoldExecutor<TraceSummaryState, AggregateEvent>({
    store,
    init: () => initTraceSummaryState(""),
    apply: applyTraceSummary,
    stateVersion: TRACE_SUMMARY_STATE_VERSION,
    projectionName: TRACE_SUMMARY_PROJECTION_NAME,
    metrics: args.metrics,
  });
}
