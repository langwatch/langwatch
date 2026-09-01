import { createLogger } from "@langwatch/observability";
import type { Projection } from "../../../domain/types";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import { RepositoryFoldStore } from "../../../projections/repositoryFoldStore";
import type { ProjectionStore } from "../../../stores/projectionStore.types";
import {
  hasRunDefiningEvent,
  type SimulationRunStateData,
} from "./simulationRunState.foldProjection";

const logger = createLogger(
  "langwatch:simulation-processing:run-state-fold-store",
);

/**
 * Fold store for simulation run state, with the gate that keeps a cost figure
 * from inventing a run.
 *
 * The run id the cost is attributed to comes off a span attribute, so it is
 * whatever reached the span. A value that names no run addressed an aggregate
 * with no lifecycle events, and the write below took its `ScenarioRunId`
 * straight from the aggregate key, which put a row in `simulation_runs` for a
 * run that never existed. The simulations page then showed it as a run in an
 * external set, with no name, no verdict and no end, and its cost and duration
 * rose with every further trace that carried the same value.
 *
 * {@link hasRunDefiningEvent} is the gate. It reads the state the fold already
 * holds, so the metrics are not thrown away: they stay in the fold state, and
 * the Redis cache in front of this store keeps that state, so a run whose cost
 * is folded before its first lifecycle event still carries the cost into the
 * row that event writes.
 */
export class SimulationRunStateFoldStore
  implements FoldProjectionStore<SimulationRunStateData>
{
  private readonly inner: RepositoryFoldStore<SimulationRunStateData>;

  constructor({
    repository,
    version,
  }: {
    repository: ProjectionStore<Projection>;
    version: string;
  }) {
    this.inner = new RepositoryFoldStore<SimulationRunStateData>(
      repository,
      version,
    );
  }

  async store(
    state: SimulationRunStateData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!hasRunDefiningEvent(state)) {
      this.reportDeclined(context);
      return;
    }
    await this.inner.store(state, context);
  }

  async storeBatch(
    entries: Array<{
      state: SimulationRunStateData;
      context: ProjectionStoreContext;
    }>,
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

  /**
   * Warn rather than debug: every decline is a trace whose cost reaches no run,
   * which is a link the product cannot rebuild later. The id is the value that
   * addressed the aggregate, so the line says which attribute value to chase.
   */
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
