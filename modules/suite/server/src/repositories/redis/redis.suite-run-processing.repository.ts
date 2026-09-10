import { RedisCachedFoldStore, RepositoryFoldStore } from "@langwatch/eventing";
import { SUITE_RUN_PROJECTION_VERSIONS, type SuiteRunStateData } from "@langwatch/suite-contract";
import type { Cluster, Redis } from "ioredis";
import { ClickhouseSuiteEventingRepository } from "../clickhouse/clickhouse.suite-eventing.repository.ts";
import {
  SuiteRunProcessingPipelineAdapter,
  type SuiteRunProcessingPipeline,
} from "../../adapters/suite-run-processing.adapter.ts";
import type { SuiteClickHouseClient } from "../../ports/suite-clickhouse.port.ts";

/**
 * The Redis keyspace the suite-run fold's read-through cache occupies. A
 * prefix drift would leave each side reading a cache the other never writes,
 * and the fold cache is the read-your-write consistency layer (ADR-066).
 */
const SUITE_RUN_FOLD_CACHE_KEY_PREFIX = "suite_runs";

export type ClickHouseSuiteRunProcessingAdapterOptions = {
  resolveClient: (projectId: string) => Promise<SuiteClickHouseClient>;
  /** The fallback for rows whose tenant declares no retention override. */
  defaultRetentionDays: number;
  /**
   * The process's own Redis, required rather than optional.
   */
  redis: Redis | Cluster;
  /**
   * The cache's consistency TTL, as the process resolved it.
   */
  foldCacheTtlSeconds?: number;
};

/**
 * Durable suite-run processing, composed from a tenant-keyed ClickHouse client and the
 * process's own Redis.
 */
export class RedisSuiteRunProcessingRepository {
  static create(
    options: ClickHouseSuiteRunProcessingAdapterOptions,
  ): RedisSuiteRunProcessingRepository {
    return new RedisSuiteRunProcessingRepository(options);
  }

  private constructor(private readonly options: ClickHouseSuiteRunProcessingAdapterOptions) {}

  buildProcessing(): SuiteRunProcessingPipeline {
    return SuiteRunProcessingPipelineAdapter.create({
      suiteRunStateFoldStore: new RedisCachedFoldStore<SuiteRunStateData>(
        new RepositoryFoldStore<SuiteRunStateData>(
          ClickhouseSuiteEventingRepository.create({
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
