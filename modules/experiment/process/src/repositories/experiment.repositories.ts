import type { ExperimentDspyRepository } from "./experiment-dspy.repository.ts";
import type { ExperimentPeopleRepository } from "./experiment-people.repository.ts";
import type { ExperimentRunProcessingStores } from "./experiment-run.repositories.ts";
import type { ExperimentRunRepository } from "./experiment-run.repository.ts";
import type { ExperimentRepository } from "./experiment.repository.ts";

/** The rows experiment reads and writes, chosen once at boot from one tier. */
export interface ExperimentRepositories {
  readonly experiments: ExperimentRepository;
  /** Historical runs, with each run's workflow version beside it. */
  readonly runHistory: ExperimentRunRepository;
  readonly dspySteps: ExperimentDspyRepository;
  readonly people: ExperimentPeopleRepository;
  readonly runProcessing: ExperimentRunProcessingStores;
}
