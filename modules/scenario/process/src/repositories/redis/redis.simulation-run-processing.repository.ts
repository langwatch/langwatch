import { type FoldProjectionStore, RedisCachedFoldStore } from "@langwatch/eventing";
import type { ProcessMembers } from "@langwatch/process-stores/members";

import { SimulationRunMetricsAppendStore } from "../../eventing/simulation-run-metrics.store.ts";
import type { SimulationRunStateData } from "../../eventing/simulation-run-state.projection.ts";
import { SimulationRunStateStoreAdapter } from "../clickhouse/clickhouse.simulation-eventing.repository.ts";
import { ClickHouseSimulationRunMetricsRepository } from "../clickhouse/clickhouse.simulation-run-metrics.repository.ts";
import {
  ClickHouseSimulationSession,
  type SimulationEventingClickHouseResolver,
} from "../clickhouse/clickhouse.simulation-session.store.ts";
import type { SimulationRunProcessingRepository } from "../simulation-run-processing.repository.ts";

/** The keyspace the run fold's read-through cache occupies (ADR-066), as main named it. */
const SIMULATION_RUN_FOLD_CACHE_KEY_PREFIX = "simulation_runs";

/** Run state and metrics in ClickHouse, the run fold cached through the process's Redis. */
export class RedisSimulationRunProcessingRepository implements SimulationRunProcessingRepository {
  private readonly resolveClient: SimulationEventingClickHouseResolver;

  private constructor(
    clickhouse: ProcessMembers["clickhouse"],
    private readonly redis: ProcessMembers["redis"],
  ) {
    this.resolveClient = ClickHouseSimulationSession.resolver(clickhouse);
  }

  static create({
    clickhouse,
    redis,
  }: Pick<ProcessMembers, "clickhouse" | "redis">): RedisSimulationRunProcessingRepository {
    return new RedisSimulationRunProcessingRepository(clickhouse, redis);
  }

  runStateStore({
    defaultRetentionDays,
  }: {
    defaultRetentionDays: () => number;
  }): FoldProjectionStore<SimulationRunStateData> {
    const durable = SimulationRunStateStoreAdapter.create({
      type: "clickhouse",
      resolveClient: this.resolveClient,
      defaultRetentionDays,
    }).createFoldStore();

    return new RedisCachedFoldStore<SimulationRunStateData>(durable, this.redis, {
      keyPrefix: SIMULATION_RUN_FOLD_CACHE_KEY_PREFIX,
    });
  }

  runMetricsStore(): SimulationRunMetricsAppendStore {
    return SimulationRunMetricsAppendStore.create(
      ClickHouseSimulationRunMetricsRepository.create(this.resolveClient),
    );
  }
}
