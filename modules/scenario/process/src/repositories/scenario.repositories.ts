import type {
  CancellationPublisher,
  CancellationSubscriber,
  ScenarioTabStore,
} from "../app/scenario.app.ts";
import type { ResultAtomsRepository } from "./result-atoms.repository.ts";
import type { RunConfigurationsRepository } from "./run-configurations.repository.ts";
import type { ScenarioRepository } from "./scenario.repository.ts";
import type { SimulationRunProcessingRepository } from "./simulation-run-processing.repository.ts";
import type { StalledSimulationRunRepository } from "./stalled-simulation-run.repository.ts";

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
  /** The install-wide stalled-run sweep only the stalled-runs-backfill task reads. */
  readonly stalledRuns: StalledSimulationRunRepository;
  /** Which browser tabs are open on a project's simulations, and the run parked for each. */
  readonly tabs: ScenarioTabStore;
  /** The Results tab's atoms, read from the run fold in ClickHouse. */
  readonly resultAtoms: ResultAtomsRepository;
  /** The configurations a project's run plans already ran with. */
  readonly runConfigurations: RunConfigurationsRepository;
}
