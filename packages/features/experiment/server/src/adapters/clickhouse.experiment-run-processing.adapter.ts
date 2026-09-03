import { RedisCachedFoldStore } from "@langwatch/eventing";
import type { Cluster, Redis } from "ioredis";
import {
  createExperimentRunProcessingPipeline,
  type ExperimentRunProcessingPipeline,
} from "./eventing.experiment-run-processing.adapter";
import {
  ExperimentClickHouseAdapter,
  type ExperimentEventingClickHouseResolver,
} from "./experiment-clickhouse.adapter";
import type { ExperimentRunStateData } from "../projections/experiment-run-state.projection";
import { ExperimentRunStateRepositoryClickHouse } from "../repositories/clickhouse/clickhouse.experiment-run-state.repository";
import { createExperimentRunItemAppendStore } from "../stores/experiment-run-item.clickhouse.store";
import { createExperimentRunStateFoldStore } from "../stores/experiment-run-state.store";

/**
 * The Redis keyspace the experiment-run fold's read-through cache occupies.
 *
 * Frozen twin: `PipelineRegistry.registerExperimentRunPipeline` passes this
 * same literal to its own `cached(...)`, and the two graphs share one Redis.
 * They may only change together — a prefix that drifted would leave each side
 * reading a cache the other never writes, and the fold cache is the
 * read-your-write consistency layer (ADR-066), so the failure is stale reads
 * rather than an error anything notices.
 */
const EXPERIMENT_RUN_FOLD_CACHE_KEY_PREFIX = "experiment_runs";

export type ClickHouseExperimentRunProcessingAdapterOptions = {
  resolveClient: ExperimentEventingClickHouseResolver;
  /** The fallback for rows whose tenant declares no retention override. */
  defaultRetentionDays: number;
  /**
   * The process's own Redis, required rather than optional.
   *
   * The fold cache is not a latency knob here: it carries the applied-event
   * ids a redelivered item is dropped on, and the run-state fold accumulates
   * by addition — every target and evaluator result adds to the run's counts,
   * costs and pass rate. A graph that composed this pipeline without one would
   * double-count a redelivered result and could complete a run on numbers that
   * never happened, so an absent Redis is a composition that must not be
   * expressible rather than one that quietly degrades.
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
 * Durable experiment-run processing, composed from a tenant-keyed ClickHouse
 * client and the process's own Redis.
 *
 * This is the whole seam a background worker needs. The App reached the same
 * pipeline through `PipelineRegistry`, which took both stores pre-built from
 * `presets.ts` and wrapped one of them in a Redis cache of its own, so the
 * assembly lived in two files and neither was the feature's. Stating it here
 * is what makes the pipeline buildable by whichever process consumes it.
 *
 * There is no ClickHouse-disabled arm. A consumer of `event-sourcing/jobs`
 * without an event store is refused before any capability is built, so the
 * memory repository the App composes for a ClickHouse-less install is not a
 * shape this graph can be in.
 */
export class ClickHouseExperimentRunProcessingAdapter {
  static create(
    options: ClickHouseExperimentRunProcessingAdapterOptions,
  ): ClickHouseExperimentRunProcessingAdapter {
    return new ClickHouseExperimentRunProcessingAdapter(options);
  }

  private constructor(private readonly options: ClickHouseExperimentRunProcessingAdapterOptions) {}

  buildProcessing(): ExperimentRunProcessingPipeline {
    const clickHouse = ExperimentClickHouseAdapter.create(this.options.resolveClient);

    return createExperimentRunProcessingPipeline({
      experimentRunStateFoldStore: new RedisCachedFoldStore<ExperimentRunStateData>(
        createExperimentRunStateFoldStore(
          new ExperimentRunStateRepositoryClickHouse(clickHouse, this.options.defaultRetentionDays),
        ),
        this.options.redis,
        {
          keyPrefix: EXPERIMENT_RUN_FOLD_CACHE_KEY_PREFIX,
          ...(this.options.foldCacheTtlSeconds === undefined
            ? {}
            : { ttlSeconds: this.options.foldCacheTtlSeconds }),
        },
      ),
      experimentRunItemAppendStore: createExperimentRunItemAppendStore(
        clickHouse,
        this.options.defaultRetentionDays,
      ),
    });
  }
}
