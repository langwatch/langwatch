import {
  type AppendStore,
  type FoldProjectionStore,
  RedisCachedFoldStore,
} from "@langwatch/eventing";
import type { Cluster, Redis } from "ioredis";

import { ExperimentRunItemStore } from "../../eventing/experiment-run-item.store.ts";
import type { ClickHouseExperimentRunResultRecord } from "../../eventing/experiment-run-result-storage.projection.ts";
import type { ExperimentRunStateData } from "../../eventing/experiment-run-state.projection.ts";
import { ExperimentRunStateStore } from "../../eventing/experiment-run-state.store.ts";
import { ClickhouseExperimentClickHouseRepository } from "../clickhouse/clickhouse.experiment-clickhouse.repository.ts";
import { ClickHouseExperimentRunStateRepository } from "../clickhouse/clickhouse.experiment-run-state.repository.ts";
import type { ExperimentEventingClickHouseResolver } from "../experiment-clickhouse.repository.ts";

/**
 * The Redis keyspace the experiment-run fold's read-through cache occupies.
 * read-your-write consistency layer (ADR-066), so the failure is stale reads
 */
const EXPERIMENT_RUN_FOLD_CACHE_KEY_PREFIX = "experiment_runs";

type ClickHouseExperimentRunProcessingAdapterOptions = {
  resolveClient: ExperimentEventingClickHouseResolver;
  /** The fallback for rows whose tenant declares no retention override. */
  defaultRetentionDays: () => number;
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
 * Durable experiment-run processing, composed from a tenant-keyed ClickHouse
 * client and the process's own Redis.
 */
export class RedisExperimentRunProcessingRepository {
  static create(
    options: ClickHouseExperimentRunProcessingAdapterOptions,
  ): RedisExperimentRunProcessingRepository {
    return new RedisExperimentRunProcessingRepository(options);
  }

  private constructor(private readonly options: ClickHouseExperimentRunProcessingAdapterOptions) {}

  /** The run-state fold, read through the Redis cache and written to ClickHouse. */
  stateFoldStore(): FoldProjectionStore<ExperimentRunStateData> {
    return new RedisCachedFoldStore<ExperimentRunStateData>(
      ExperimentRunStateStore.create({
        repository: ClickHouseExperimentRunStateRepository.create({
          clickhouse: this.clickHouse(),
          defaultRetentionDays: this.options.defaultRetentionDays,
        }),
      }),
      this.options.redis,
      {
        keyPrefix: EXPERIMENT_RUN_FOLD_CACHE_KEY_PREFIX,
        ...(this.options.foldCacheTtlSeconds === undefined
          ? {}
          : { ttlSeconds: this.options.foldCacheTtlSeconds }),
      },
    );
  }

  /** The run-item append, straight to ClickHouse. */
  itemStore(): AppendStore<ClickHouseExperimentRunResultRecord> {
    return ExperimentRunItemStore.create({
      clickhouse: this.clickHouse(),
      defaultRetentionDays: this.options.defaultRetentionDays,
    });
  }

  private clickHouse(): ClickhouseExperimentClickHouseRepository {
    return ClickhouseExperimentClickHouseRepository.create(this.options.resolveClient);
  }
}
