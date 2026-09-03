import { RedisCachedFoldStore, RepositoryFoldStore } from "@langwatch/eventing";
import { SUITE_RUN_PROJECTION_VERSIONS, type SuiteRunStateData } from "@langwatch/suite-contract";
import type { Cluster, Redis } from "ioredis";
import { ClickHouseSuiteEventingAdapter } from "./clickhouse.suite-eventing.adapter";
import {
  createSuiteRunProcessingPipeline,
  type SuiteRunProcessingPipeline,
} from "./suite-run-processing.adapter";
import type { SuiteClickHouseClient } from "../ports/suite-clickhouse.port";

/**
 * The Redis keyspace the suite-run fold's read-through cache occupies.
 *
 * Frozen twin: `PipelineRegistry.registerSuiteRunPipeline` passes this same
 * literal to its own `cached(...)`, and the two graphs share one Redis. They
 * may only change together — a prefix that drifted would leave each side
 * reading a cache the other never writes, and the fold cache is the read-
 * your-write consistency layer (ADR-066), so the failure is stale reads rather
 * than an error anything notices.
 */
const SUITE_RUN_FOLD_CACHE_KEY_PREFIX = "suite_runs";

export type ClickHouseSuiteRunProcessingAdapterOptions = {
  resolveClient: (projectId: string) => Promise<SuiteClickHouseClient>;
  /** The fallback for rows whose tenant declares no retention override. */
  defaultRetentionDays: number;
  /**
   * The process's own Redis, required rather than optional.
   *
   * The fold cache is not a latency knob here: it carries the applied-event
   * ids the executor drops a redelivery on, and the suite-run fold accumulates
   * by addition. A graph that composed this pipeline without one would
   * double-count a redelivered item and could flip a run to SUCCESS or FAILURE
   * before it finished — so an absent Redis is a composition that must not be
   * expressible, not one that quietly degrades.
   */
  redis: Redis | Cluster;
  /**
   * The cache's consistency TTL, as the process resolved it.
   *
   * Read from the same environment variable the App reads, because the App
   * still produces into this pipeline while this process consumes it: two
   * graphs writing one keyspace under different TTLs would expire each other's
   * entries early. Absent means the store's own default, which already sits at
   * the replication-lag floor.
   */
  foldCacheTtlSeconds?: number;
};

/**
 * Durable suite-run processing, composed from a tenant-keyed ClickHouse client
 * and the process's own Redis.
 *
 * This is the whole seam a background worker needs. The App reached the same
 * pipeline through `PipelineRegistry`, which built the fold store out of three
 * pieces held in three different places — the projection store on the suite
 * runtime, the projection version in the contract, and the Redis cache on the
 * registry — so nothing outside the App could assemble one. Stating the
 * assembly here is what makes the pipeline buildable by whichever process
 * consumes it.
 */
export class ClickHouseSuiteRunProcessingAdapter {
  static create(
    options: ClickHouseSuiteRunProcessingAdapterOptions,
  ): ClickHouseSuiteRunProcessingAdapter {
    return new ClickHouseSuiteRunProcessingAdapter(options);
  }

  private constructor(private readonly options: ClickHouseSuiteRunProcessingAdapterOptions) {}

  buildProcessing(): SuiteRunProcessingPipeline {
    return createSuiteRunProcessingPipeline({
      suiteRunStateFoldStore: new RedisCachedFoldStore<SuiteRunStateData>(
        new RepositoryFoldStore<SuiteRunStateData>(
          ClickHouseSuiteEventingAdapter.create({
            resolveClient: this.options.resolveClient,
            defaultRetentionDays: this.options.defaultRetentionDays,
          }).build().suiteRunState,
          SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
        ),
        this.options.redis,
        {
          keyPrefix: SUITE_RUN_FOLD_CACHE_KEY_PREFIX,
          ...(this.options.foldCacheTtlSeconds === undefined
            ? {}
            : { ttlSeconds: this.options.foldCacheTtlSeconds }),
        },
      ),
    });
  }
}
