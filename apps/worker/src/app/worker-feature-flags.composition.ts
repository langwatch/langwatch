import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import {
  PostgresFeatureFlagAdapter,
  RedisFeatureFlagCacheAdapter,
  type FeatureFlagDatabase,
  type FeatureFlagExperimentDatabase,
} from "@langwatch/feature-flag-server";
import type { WorkerConfig } from "../platform/config/worker.config";

/** The two models the flag store reads from the client. */
export type WorkerFeatureFlagDatabase = FeatureFlagDatabase & FeatureFlagExperimentDatabase;

/**
 * How this process reaches the shared flag cache.
 *
 * Structural rather than a `RedisConnection`, because it is three commands and
 * the adapter already accepts `null` for a deployment that has no Redis to
 * share.
 */
export type WorkerFeatureFlagRedis = {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

/**
 * The kill switches and rollout rules this process reads.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still owns
 * `RecordSpanCommand` — so nothing in this process reads a flag yet. What has
 * to be true today is that this composition root CAN build the service from
 * what it already holds: the one Prisma client, the queue's Redis and the
 * overrides its own environment carries.
 *
 *     FeatureFlagService                 (feature-flag-server owns it)
 *       ├─ PrismaFeatureFlagRowAdapter   the stored rules
 *       ├─ the experiment settings row   per-project rollout state
 *       ├─ CachedFeatureFlagRowAdapter   process tier over the shared tier
 *       │    └─ RedisFeatureFlagCacheAdapter
 *       └─ FeatureFlagConfig             this deployment's overrides
 *
 * WHY REDIS IS OPTIONAL AND THE ABSENCE IS NOT A REFUSAL. Every flag has a
 * stored row; the cache only decides how often it is re-read. A process
 * without Redis falls back to the adapter's own in-memory tier and answers the
 * same values a little more often from Postgres, which is what the application
 * does when Redis is down. That is different from the mail capability, where
 * an absent variable would have produced mail nobody could act on.
 *
 * WHY ONE PER PROCESS. The service holds a per-process cache tier whose value
 * depends on being shared by every caller in the process. Two of these would
 * halve the hit rate and let two callers disagree for a TTL about whether a
 * kill switch is thrown.
 */
export function createWorkerFeatureFlags(options: {
  database: WorkerFeatureFlagDatabase;
  config: WorkerConfig;
  redis?: WorkerFeatureFlagRedis | null;
  now?: () => number;
}): FeatureFlagService {
  return PostgresFeatureFlagAdapter.create({
    database: options.database,
    cache: RedisFeatureFlagCacheAdapter.create(options.redis ?? null),
    config: options.config.featureFlags,
    now: options.now ?? (() => Date.now()),
  });
}
