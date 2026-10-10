import {
  RepositoryFoldStore,
  type FoldProjectionStore,
  type Projection,
  type ProjectionStore,
  type ProjectionStoreReadContext,
  type ProjectionStoreWriteContext,
  type ProjectionStoreContext,
  type FoldStateRead,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { SIMULATION_PROJECTION_VERSIONS } from "@langwatch/scenario-contract";

import { ClickHouseSimulationRunStateRepository } from "../repositories/clickhouse/clickhouse.simulation-run-state.repository.ts";
import type { SimulationEventingClickHouseResolver } from "../repositories/clickhouse/clickhouse.simulation-session.store.ts";
import { MemorySimulationRunStateRepository } from "../repositories/memory/memory.simulation-run-state.repository.ts";
import {
  BACKFILL_STALE_THRESHOLD_MS,
  type StalledHistoricalRun,
} from "../repositories/stalled-simulation-run.repository.ts";
import {
  SimulationRunStateFoldProjection,
  type SimulationRunState,
  type SimulationRunStateData,
} from "./simulation-run-state.projection.ts";

const logger = createLogger("scenario:simulation-run-state-fold-store");

/**
 * Fold store for simulation run state, with the gate that keeps a cost figure from inventing a run.
 */
class GatedSimulationRunStateFoldStore implements FoldProjectionStore<SimulationRunStateData> {
  constructor(private readonly inner: FoldProjectionStore<SimulationRunStateData>) {}

  async store(state: SimulationRunStateData, context: ProjectionStoreContext): Promise<void> {
    if (!SimulationRunStateFoldProjection.hasRunDefiningEvent(state)) {
      this.reportDeclined(context);
      return;
    }
    await this.inner.store(state, context);
  }

  async storeBatch(
    entries: { state: SimulationRunStateData; context: ProjectionStoreContext }[],
  ): Promise<void> {
    const writable = entries.filter(({ state, context }) => {
      if (SimulationRunStateFoldProjection.hasRunDefiningEvent(state)) return true;
      this.reportDeclined(context);
      return false;
    });
    if (writable.length === 0) return;
    if (this.inner.storeBatch) {
      await this.inner.storeBatch(writable);
      return;
    }
    for (const { state, context } of writable) await this.inner.store(state, context);
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<SimulationRunStateData>> {
    return this.inner.get(aggregateId, context);
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

export class SimulationRunStateStore implements ProjectionStore {
  static create(
    options:
      | {
          type: "clickhouse";
          resolveClient: SimulationEventingClickHouseResolver;
          defaultRetentionDays: () => number;
        }
      | { type: "memory"; runs?: MemorySimulationRunStateRepository<SimulationRunState> },
  ): SimulationRunStateStore {
    const store =
      options.type === "clickhouse"
        ? ClickHouseSimulationRunStateRepository.create(options)
        : (options.runs ?? MemorySimulationRunStateRepository.create());

    return new SimulationRunStateStore(store);
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

  findProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<Projection | null> {
    return this.store.findProjection(aggregateId, context);
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
