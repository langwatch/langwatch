import { RedisCachedFoldStore, type FoldProjectionStore } from "@langwatch/eventing";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type { RedisConnection } from "@langwatch/redis-client";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  ClickHouseTraceProjectionStorageAdapter,
  TraceAnalyticsRollupStore,
  TraceAnalyticsStore,
  TraceSummaryStore,
  type TraceAnalyticsData,
} from "@langwatch/trace-server";

/**
 * The three fold and rollup writers the trace pipeline commits through.
 *
 * TWO OF THE THREE ARE CACHE KEYS, AND THE KEYS ARE A WIRE CONTRACT. While both
 * graphs ingest, a trace's fold may be advanced by either process, and both
 * read the warm tier out of the SAME Redis keyspace (ADR-066). `trace_summaries`
 * and `trace_analytics` are therefore literals here rather than anything
 * derived: a prefix spelled differently would not fail — it would quietly give
 * this process its own empty cache, so every fold would re-read ClickHouse and,
 * worse, the two processes would stop seeing each other's applied-event-id sets
 * and a redelivered batch could be folded twice into a state that accumulates
 * by addition.
 *
 * THE TTL IS THE DEPLOYMENT'S OWN, read from the same variable the application
 * reads, so neither process can expire the other's entries early. Absent, the
 * wrapper's own 300-second floor applies.
 *
 * NO REDIS IS NOT A REFUSAL HERE. The durable store alone is correct — every
 * read falls through to ClickHouse, which is what the application does on the
 * same deployment — so the cache is composed when there is one and skipped when
 * there is not, rather than the process refusing to fold at all.
 *
 *     traceSummaryStore    RedisCachedFoldStore("trace_summaries")
 *                            └─ TraceSummaryStore
 *                                 └─ ClickHouse `trace_summaries`
 *     traceAnalyticsStore  RedisCachedFoldStore("trace_analytics")
 *                            └─ TraceAnalyticsStore
 *                                 └─ ClickHouse `trace_analytics`
 *     rollup               TraceAnalyticsRollupStore   (append-only, never cached)
 *                            └─ ClickHouse `trace_analytics_rollup`
 */
export type WorkerTraceProjectionStores = {
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  traceAnalyticsStore: FoldProjectionStore<TraceAnalyticsData>;
  traceAnalyticsRollupAppendStore: TraceAnalyticsRollupStore;
};

export function createWorkerTraceProjectionStores(options: {
  resolveClickHouseClient: EventingClickHouseClientResolver;
  /** The number the event store already stamps its own rows with. */
  defaultRetentionDays: number;
  /** The queue's own Redis, or nothing on a deployment that configured none. */
  redis?: RedisConnection | null;
  /** `LANGWATCH_FOLD_CACHE_TTL_SECONDS`, read once by the process. */
  foldCacheTtlSeconds?: number;
}): WorkerTraceProjectionStores {
  const storage = {
    resolveClient: options.resolveClickHouseClient,
    defaultRetentionDays: options.defaultRetentionDays,
  };

  const durableSummary = TraceSummaryStore.create({
    storage: ClickHouseTraceProjectionStorageAdapter.createSummary(storage),
    defaultRetentionDays: options.defaultRetentionDays,
  });
  const durableAnalytics = TraceAnalyticsStore.create({
    storage: ClickHouseTraceProjectionStorageAdapter.createAnalytics(storage),
    defaultRetentionDays: options.defaultRetentionDays,
  });

  return {
    traceSummaryStore: cached(durableSummary, "trace_summaries", options),
    traceAnalyticsStore: cached(durableAnalytics, "trace_analytics", options),
    traceAnalyticsRollupAppendStore: TraceAnalyticsRollupStore.create({
      storage: ClickHouseTraceProjectionStorageAdapter.createAnalyticsRollup(storage),
      defaultRetentionDays: options.defaultRetentionDays,
    }),
  };
}

function cached<State>(
  durable: FoldProjectionStore<State>,
  keyPrefix: string,
  options: { redis?: RedisConnection | null; foldCacheTtlSeconds?: number },
): FoldProjectionStore<State> {
  if (!options.redis) return durable;

  return new RedisCachedFoldStore<State>(durable, options.redis, {
    keyPrefix,
    ...(options.foldCacheTtlSeconds === undefined
      ? {}
      : { ttlSeconds: options.foldCacheTtlSeconds }),
  });
}
