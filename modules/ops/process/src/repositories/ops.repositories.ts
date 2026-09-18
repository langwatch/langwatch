import type { BugReportRepository } from "./admin/bug-report.repository.ts";

/**
 * The rows this module owns in the platform's own database. One entry so
 * far: the support inbox. Everything else lives in Redis, ClickHouse or
 * the event store, reaching the module as members the process supplies.
 */
export interface OpsRepositories {
  readonly bugReports: BugReportRepository;
}
