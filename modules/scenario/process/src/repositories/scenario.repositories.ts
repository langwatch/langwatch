import type { ScenarioTabStore } from "../app/scenario.app.ts";
import type { ResultAtomsRepository } from "./result-atoms.repository.ts";
import type { RunConfigurationsRepository } from "./run-configurations.repository.ts";
import type { ScenarioCancellationRepository } from "./scenario-cancellation.repository.ts";
import type { ScenarioRateLimitRepository } from "./scenario-rate-limit.repository.ts";
import type { ScenarioRepository } from "./scenario.repository.ts";
import type { SimulationRunProcessingRepository } from "./simulation-run-processing.repository.ts";
import type { SimulationRepository } from "./simulation.repository.ts";
import type { StalledSimulationRunRepository } from "./stalled-simulation-run.repository.ts";
import type { VoiceNonceRepository } from "./voice-nonce.repository.ts";

/**
 * The persistence one Scenario application is built over: the test case and
 * its suites in Postgres, the simulation run fold and metrics in ClickHouse,
 * and the cancellation signal a running child listens for.
 */
export interface ScenarioRepositories {
  readonly scenarios: ScenarioRepository;
  readonly simulationRunProcessing: SimulationRunProcessingRepository;
  /** The install-wide stalled-run sweep only the stalled-runs-backfill task reads. */
  readonly stalledRuns: StalledSimulationRunRepository;
  /** Which browser tabs are open on a project's simulations, and the run parked for each. */
  readonly tabs: ScenarioTabStore;
  /** The Results tab's atoms, read from the run fold in ClickHouse. */
  readonly resultAtoms: ResultAtomsRepository;
  /** The configurations a project's run plans already ran with. */
  readonly runConfigurations: RunConfigurationsRepository;
  /** The Twilio media nonces the worker's door takes, one use each. */
  readonly voiceNonces: VoiceNonceRepository;
  /** The runs and batches a simulation produced, read from the run fold in ClickHouse. */
  readonly simulations: SimulationRepository;
  /** The author-assist's generation window. */
  readonly rateLimits: ScenarioRateLimitRepository;
  /** The cancel signal a running child listens for, across every replica. */
  readonly cancellations: ScenarioCancellationRepository;
}
