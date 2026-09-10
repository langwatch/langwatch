import type { ScenarioRepository } from "./scenario.repository.ts";

/**
 * The persistence one Scenario application is built over. One aggregate
 * today: the test case and its test suites. Simulation run state, results and
 * run configurations are ClickHouse-backed and keep their own repositories
 * (see `simulation.repository.ts`, `simulation-run-state.repository.ts`,
 * `simulation-run-metrics.repository.ts`), unregistered here because they are
 * not selected by this feature's `.withPersistence(...)` choice.
 */
export interface ScenarioRepositories {
  readonly scenarios: ScenarioRepository;
}
