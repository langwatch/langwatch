import type { ClickHouseClient } from "@clickhouse/client";
import {
  RepositoryFoldStore,
  type AppendStore,
  type BulkAppendContext,
  type FoldProjectionStore,
  type Projection,
  type ProjectionStore,
  type ProjectionStoreReadContext,
  type ProjectionStoreWriteContext,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import { SIMULATION_PROJECTION_VERSIONS } from "@langwatch/scenario-contract";
import { ClickHouseSimulationRunMetricsRepository } from "../repositories/clickhouse/clickhouse.simulation-run-metrics.repository";
import { ClickHouseSimulationRunStateRepository } from "../repositories/clickhouse/clickhouse.simulation-run-state.repository";
import { ClickHouseStalledSimulationRunRepository } from "../repositories/clickhouse/clickhouse.stalled-simulation-run.repository";
import { MemorySimulationRunStateRepository } from "../repositories/memory/memory.simulation-run-state.repository";
import type { SimulationRunMetricsProjectionRecord } from "../projections/simulation-run-metrics.projection";
import type { SimulationRunStateData } from "../projections/simulation-run-state.projection";
import {
  BACKFILL_STALE_THRESHOLD_MS,
  type StalledHistoricalRun,
} from "../repositories/stalled-simulation-run.repository";
import { SimulationRunMetricsAppendStore } from "../stores/eventing/eventing.simulation-run-metrics.store";

export type SimulationStalledRun = StalledHistoricalRun;
export { BACKFILL_STALE_THRESHOLD_MS };

type SimulationRunMetricsAppendPort = {
  append(
    record: SimulationRunMetricsProjectionRecord,
    context: ProjectionStoreContext,
  ): Promise<void>;
  bulkAppend(
    records: SimulationRunMetricsProjectionRecord[],
    context: BulkAppendContext,
  ): Promise<void>;
};

export class SimulationRunStateStoreAdapter implements ProjectionStore {
  static create(
    options:
      | {
          type: "clickhouse";
          resolveClient: (projectId: string) => Promise<ClickHouseClient>;
          defaultRetentionDays: number;
        }
      | { type: "memory" },
  ): SimulationRunStateStoreAdapter {
    const store =
      options.type === "clickhouse"
        ? ClickHouseSimulationRunStateRepository.create(options)
        : MemorySimulationRunStateRepository.create();

    return new SimulationRunStateStoreAdapter(store);
  }

  private constructor(private readonly store: ProjectionStore) {}

  createFoldStore(): FoldProjectionStore<SimulationRunStateData> {
    return new RepositoryFoldStore<SimulationRunStateData>(
      this,
      SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
    );
  }

  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<Projection | null> {
    return this.store.getProjection(aggregateId, context);
  }

  storeProjection(projection: Projection, context: ProjectionStoreWriteContext): Promise<void> {
    return this.store.storeProjection(projection, context);
  }

  async storeProjectionBatch(
    projections: Projection[],
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    if (this.store.storeProjectionBatch) {
      await this.store.storeProjectionBatch(projections, context);
      return;
    }

    for (const projection of projections) {
      await this.store.storeProjection(projection, context);
    }
  }
}

export class SimulationRunMetricsStoreAdapter implements AppendStore<SimulationRunMetricsProjectionRecord> {
  static create(
    options:
      | {
          type: "clickhouse";
          resolveClient: (projectId: string) => Promise<ClickHouseClient>;
        }
      | { type: "null" },
  ): SimulationRunMetricsStoreAdapter {
    if (options.type === "null") {
      return new SimulationRunMetricsStoreAdapter({
        async append() {},
        async bulkAppend() {},
      });
    }

    const repository = ClickHouseSimulationRunMetricsRepository.create(options.resolveClient);
    const store = SimulationRunMetricsAppendStore.create(repository);
    return new SimulationRunMetricsStoreAdapter(store);
  }

  private constructor(private readonly store: SimulationRunMetricsAppendPort) {}

  append(
    record: SimulationRunMetricsProjectionRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    return this.store.append(record, context);
  }

  bulkAppend(
    records: SimulationRunMetricsProjectionRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    return this.store.bulkAppend(records, context);
  }
}

export class SimulationStalledRunAdapter {
  static create(client: ClickHouseClient): SimulationStalledRunAdapter {
    return new SimulationStalledRunAdapter(ClickHouseStalledSimulationRunRepository.create(client));
  }

  private constructor(private readonly repository: ClickHouseStalledSimulationRunRepository) {}

  findStalledRuns(input: { now: number; thresholdMs: number }): Promise<SimulationStalledRun[]> {
    return this.repository.findStalledRuns(input);
  }
}
