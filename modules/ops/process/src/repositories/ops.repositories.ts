import type { ProcessStore } from "@langwatch/eventing";

import type { BugReportRepository } from "./admin/bug-report.repository.ts";

/**
 * The rows this module owns in the platform's own database — the support
 * inbox — and the process-manager store the manager explorer reads. The
 * rest lives in Redis, ClickHouse or the event store, reaching it as members.
 */
export interface OpsRepositories {
  readonly bugReports: BugReportRepository;
  readonly processStore: ProcessStore;
}
