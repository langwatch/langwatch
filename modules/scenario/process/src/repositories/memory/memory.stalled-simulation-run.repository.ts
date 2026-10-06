import type { SimulationRunState } from "../../eventing/simulation-run-state.projection.ts";
import {
  StalledSimulationRunRepository,
  type StalledHistoricalRun,
} from "../stalled-simulation-run.repository.ts";
import type { MemorySimulationRunStateRepository } from "./memory.simulation-run-state.repository.ts";

/** Statuses a run can be left in when no terminal event was ever written. */
const NON_TERMINAL_STATUSES = new Set(["QUEUED", "PENDING", "IN_PROGRESS"]);

/** A result past this means the sweep, not the population, is wrong: the live sweep's cap. */
const MAX_ROWS = 100_000;

/**
 * The install-wide stalled-run sweep over the memory run fold: every tenant's unfinished,
 * unarchived run whose last update is older than the threshold, oldest first.
 */
export class MemoryStalledSimulationRunRepository extends StalledSimulationRunRepository {
  private constructor(
    private readonly runs: MemorySimulationRunStateRepository<SimulationRunState>,
  ) {
    super();
  }

  static create({
    runs,
  }: {
    runs: MemorySimulationRunStateRepository<SimulationRunState>;
  }): MemoryStalledSimulationRunRepository {
    return new MemoryStalledSimulationRunRepository(runs);
  }

  async findStalledRuns({
    now,
    thresholdMs,
  }: {
    now: number;
    thresholdMs: number;
  }): Promise<StalledHistoricalRun[]> {
    const staleBeforeMs = now - thresholdMs;
    const stalled = this.runs
      .findAll()
      .filter(
        ({ data }) =>
          data.UpdatedAt < staleBeforeMs &&
          data.FinishedAt == null &&
          data.ArchivedAt == null &&
          NON_TERMINAL_STATUSES.has(data.Status),
      )
      .toSorted((left, right) => left.data.UpdatedAt - right.data.UpdatedAt);
    if (stalled.length >= MAX_ROWS) {
      throw new Error(
        `Stalled-run sweep hit the ${MAX_ROWS}-row sanity cap; refusing to mass-error what is probably a live population.`,
      );
    }
    return stalled.map((projection) => ({
      tenantId: String(projection.tenantId),
      scenarioRunId: projection.aggregateId || projection.data.ScenarioRunId,
      scenarioId: projection.data.ScenarioId,
      batchRunId: projection.data.BatchRunId,
      scenarioSetId: projection.data.ScenarioSetId,
      status: projection.data.Status,
    }));
  }
}
