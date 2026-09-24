import type { CancellationPublisher, CancellationSubscriber } from "../app/scenario.app.ts";
import type { ScenarioRepository } from "./scenario.repository.ts";
import type { SimulationRunProcessingRepository } from "./simulation-run-processing.repository.ts";

/**
 * The persistence one Scenario application is built over: the test case and
 * its suites in Postgres, the simulation run fold and metrics in ClickHouse,
 * and the cancellation signal a running child listens for.
 */
export interface ScenarioRepositories {
  readonly scenarios: ScenarioRepository;
  readonly simulationRunProcessing: SimulationRunProcessingRepository;
  readonly cancellations: CancellationPublisher;
  /** The same signal, received: only a consuming executor subscribes. */
  readonly cancellationSubscriptions: CancellationSubscriber;
}
