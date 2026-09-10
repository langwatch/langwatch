import type { SuiteRepository } from "./suite.repository.ts";

/**
 * The rows this feature owns. The run projection is not among them: it is read
 * from ClickHouse through the process's own `clickhouse` member, which the
 * app builds its run repository over.
 */
export interface SuiteRepositories {
  readonly suites: SuiteRepository;
}
