import {
  StalledSimulationRunRepository,
  type StalledHistoricalRun,
} from "../stalled-simulation-run.repository.ts";

/** No simulation-run history is held in memory, so there is never a stalled run to close. */
export class MemoryStalledSimulationRunRepository extends StalledSimulationRunRepository {
  private constructor() {
    super();
  }

  static create(): MemoryStalledSimulationRunRepository {
    return new MemoryStalledSimulationRunRepository();
  }

  findStalledRuns(_params: { now: number; thresholdMs: number }): Promise<StalledHistoricalRun[]> {
    return Promise.resolve([]);
  }
}
