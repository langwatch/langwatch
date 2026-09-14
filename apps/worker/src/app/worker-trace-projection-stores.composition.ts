import { RedisCachedFoldStore, type FoldProjectionStore } from "@langwatch/eventing";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type { RedisConnection } from "@langwatch/redis-client";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  TraceAnalyticsClickHouseRepository,
  TraceAnalyticsRollupClickHouseRepository,
  TraceAnalyticsRollupStore,
  TraceAnalyticsStore,
  TraceSummaryProjectionClickHouseRepository,
  TraceSummaryStore,
  type TraceAnalyticsData,
} from "@langwatch/trace-server";

/**
 * Three fold and rollup writers; two cache keys share Redis keyspace with the
 * application.
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
    storage: TraceSummaryProjectionClickHouseRepository.create(storage),
    defaultRetentionDays: options.defaultRetentionDays,
  });
  const durableAnalytics = TraceAnalyticsStore.create({
    storage: TraceAnalyticsClickHouseRepository.create(storage),
    defaultRetentionDays: options.defaultRetentionDays,
  });

  return {
    traceSummaryStore: cached(durableSummary, "trace_summaries", options),
    traceAnalyticsStore: cached(durableAnalytics, "trace_analytics", options),
    traceAnalyticsRollupAppendStore: TraceAnalyticsRollupStore.create({
      storage: TraceAnalyticsRollupClickHouseRepository.create(storage),
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
