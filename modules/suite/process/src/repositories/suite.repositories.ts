import type { SuiteRunProcessingRepository } from "./suite-run-processing.repository.ts";
import type { SuiteRepository } from "./suite.repository.ts";

/** The rows this feature owns, and the store its run fold is kept in. */
export interface SuiteRepositories {
  readonly suites: SuiteRepository;
  readonly runProcessing: SuiteRunProcessingRepository;
}
