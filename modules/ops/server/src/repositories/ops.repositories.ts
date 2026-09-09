import type { BugReportRepository } from "./bug-report.repository.ts";

/**
 * The rows this module owns in the platform's own database.
 *
 * One entry so far: the support inbox. Everything else the operator surface
 * reads lives in Redis, ClickHouse or the event store, and reaches the module
 * as infrastructure the process supplies rather than as a repository whose
 * backend is chosen at boot.
 */
export interface OpsRepositories {
  readonly bugReports: BugReportRepository;
}
