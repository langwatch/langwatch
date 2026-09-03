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
import { createLogger } from "@langwatch/observability";
import { SIMULATION_PROJECTION_VERSIONS } from "@langwatch/scenario-contract";
import { ClickHouseSimulationRunMetricsRepository } from "../repositories/clickhouse/clickhouse.simulation-run-metrics.repository";
import { ClickHouseSimulationRunStateRepository } from "../repositories/clickhouse/clickhouse.simulation-run-state.repository";
import { ClickHouseStalledSimulationRunRepository } from "../repositories/clickhouse/clickhouse.stalled-simulation-run.repository";
import { MemorySimulationRunStateRepository } from "../repositories/memory/memory.simulation-run-state.repository";
import type { SimulationRunMetricsProjectionRecord } from "../projections/simulation-run-metrics.projection";
import {
  hasRunDefiningEvent,
  type SimulationRunStateData,
} from "../projections/simulation-run-state.projection";
import {
  BACKFILL_STALE_THRESHOLD_MS,
  type StalledHistoricalRun,
} from "../repositories/stalled-simulation-run.repository";
import { SimulationRunMetricsAppendStore } from "../stores/eventing/eventing.simulation-run-metrics.store";

const logger = createLogger("scenario:simulation-run-state-fold-store");

/**
 * Fold store for simulation run state, with the gate that keeps a cost figure
 * from inventing a run.
 *
 * The run id a cost is attributed to comes off a span attribute, so a
 * misattributed value addresses an aggregate with no lifecycle events, and a
 * naive write takes `ScenarioRunId` straight from the aggregate key — putting
 * a row in `simulation_runs` for a run that never existed, with no name, no
 * verdict, no end, and cost that rises with every further trace.
 * {@link hasRunDefiningEvent} is the gate: metrics still accumulate in the
 * fold state, and reach the table with the run's first lifecycle event.
 */
class GatedSimulationRunStateFoldStore implements FoldProjectionStore<SimulationRunStateData> {
  constructor(private readonly inner: FoldProjectionStore<SimulationRunStateData>) {}

  async store(state: SimulationRunStateData, context: ProjectionStoreContext): Promise<void> {
    if (!hasRunDefiningEvent(state)) {
      this.reportDeclined(context);
      return;
    }
    await this.inner.store(state, context);
  }

  async storeBatch(
    entries: Array<{ state: SimulationRunStateData; context: ProjectionStoreContext }>,
  ): Promise<void> {
    const writable = entries.filter(({ state, context }) => {
      if (hasRunDefiningEvent(state)) return true;
      this.reportDeclined(context);
      return false;
    });
    if (writable.length === 0) return;
    await this.inner.storeBatch(writable);
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<SimulationRunStateData | null> {
    return await this.inner.get(aggregateId, context);
  }

  private reportDeclined(context: ProjectionStoreContext): void {
    logger.warn(
      {
        tenantId: String(context.tenantId),
        scenarioRunId: String(context.key ?? context.aggregateId),
      },
      "Simulation run cost arrived for a run with no lifecycle event, holding it out of simulation_runs",
    );
  }
}

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
    return new GatedSimulationRunStateFoldStore(
      new RepositoryFoldStore<SimulationRunStateData>(
        this,
        SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
      ),
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
