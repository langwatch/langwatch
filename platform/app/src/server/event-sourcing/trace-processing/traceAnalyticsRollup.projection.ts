import type { ClickHouseClient } from "@langwatch/clickhouse";
import { createFoldExecutor, deriveStateVersion, type AggregateEvent, type Metrics } from "@langwatch/event-sourcing";
import { z } from "zod";
import { createTraceAnalyticsRollupStore, initRollupState } from "./traceAnalyticsRollup.store";
import { applyRollup, TRACE_ANALYTICS_ROLLUP_PROJECTION_NAME, type RollupState } from "./traceAnalyticsRollup";

const rollupStateSchema = z.object({
  bucketStartMs: z.number(),
  model: z.string(),
  spanType: z.string(),
  spanCount: z.number(),
  traceCount: z.number(),
  errorCount: z.number(),
  costSum: z.number(),
  nonBilledCostSum: z.number(),
  durationSum: z.number(),
  promptTokensSum: z.number(),
  completionTokensSum: z.number(),
  cacheReadTokensSum: z.number(),
  cacheWriteTokensSum: z.number(),
  reasoningTokensSum: z.number(),
});

export const TRACE_ANALYTICS_ROLLUP_STATE_VERSION = deriveStateVersion(rollupStateSchema);

export function createTraceAnalyticsRollupProjection(args: {
  readonly client: ClickHouseClient;
  readonly metrics?: Metrics;
}): ReturnType<typeof createFoldExecutor<RollupState, AggregateEvent>> {
  const store = createTraceAnalyticsRollupStore({ client: args.client, expectedVersion: TRACE_ANALYTICS_ROLLUP_STATE_VERSION });

  return createFoldExecutor<RollupState, AggregateEvent>({
    store,
    init: initRollupState,
    apply: applyRollup,
    stateVersion: TRACE_ANALYTICS_ROLLUP_STATE_VERSION,
    projectionName: TRACE_ANALYTICS_ROLLUP_PROJECTION_NAME,
    metrics: args.metrics,
  });
}
