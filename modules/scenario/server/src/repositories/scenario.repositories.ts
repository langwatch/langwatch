import type { ScenarioRepository } from "./scenario.repository.ts";

/**
 * The persistence one Scenario application is built over: one aggregate
 * today, the test case and its suites. Run state, results and
 * configurations are ClickHouse-backed, unregistered here (not selected).
 */
export interface ScenarioRepositories {
  readonly scenarios: ScenarioRepository;
}
