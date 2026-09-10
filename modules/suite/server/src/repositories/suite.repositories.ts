import type { SuiteRepository } from "./suite.repository.ts";

/**
 * The rows this feature owns. The run projection is not among them: it is read
 * from ClickHouse through {@link SuiteClickHouseClient}, which the process
 * supplies as members.
 */
export interface SuiteRepositories {
  readonly suites: SuiteRepository;
}
