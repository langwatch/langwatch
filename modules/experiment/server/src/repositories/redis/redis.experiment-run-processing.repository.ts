import { RedisCachedFoldStore } from "@langwatch/eventing";
import type { Cluster, Redis } from "ioredis";
import {
  ExperimentEventingAdapter,
  type ExperimentRunProcessingPipeline,
} from "../clickhouse/clickhouse.experiment-run-processing.repository.ts";
import {
  ClickhouseExperimentClickHouseRepository,
  type ExperimentEventingClickHouseResolver,
} from "../clickhouse/clickhouse.experiment-clickhouse.repository.ts";
import type { ExperimentRunStateData } from "../../projections/experiment-run-state.projection.ts";
import { ClickHouseExperimentRunStateRepository } from "../clickhouse/clickhouse.experiment-run-state.repository.ts";
import { ExperimentRunItemStore } from "../../stores/eventing/eventing.experiment-run-item.store.ts";
import { ExperimentRunStateStore } from "../../stores/eventing/eventing.experiment-run-state.store.ts";

/**
 * The Redis keyspace the experiment-run fold's read-through cache occupies.
 * read-your-write consistency layer (ADR-066), so the failure is stale reads
 */
const EXPERIMENT_RUN_FOLD_CACHE_KEY_PREFIX = "experiment_runs";

export type ClickHouseExperimentRunProcessingAdapterOptions = {
  resolveClient: ExperimentEventingClickHouseResolver;
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

  buildProcessing(): ExperimentRunProcessingPipeline {
    const clickHouse = ClickhouseExperimentClickHouseRepository.create(this.options.resolveClient);

    return ExperimentEventingAdapter.pipeline({
      experimentRunStateFoldStore: new RedisCachedFoldStore<ExperimentRunStateData>(
        ExperimentRunStateStore.create({
          repository: ClickHouseExperimentRunStateRepository.create({
            clickhouse: clickHouse,
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
      ),
      experimentRunItemAppendStore: ExperimentRunItemStore.create({
        clickhouse: clickHouse,
        defaultRetentionDays: this.options.defaultRetentionDays,
      }),
    });
  }
}
