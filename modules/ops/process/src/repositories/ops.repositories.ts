import type { ProcessStore } from "@langwatch/eventing";

import type { BugReportRepository } from "./bug-report.repository.ts";
import type { ProcessManagerPurgeRepository } from "./process-manager-purge.repository.ts";

/**
 * The rows this module owns in the platform's own database — the support
 * inbox — and the process-manager store the manager explorer reads. The
 * rest lives in Redis, ClickHouse or the event store, reaching it as members.
 */
export interface OpsRepositories {
  readonly bugReports: BugReportRepository;
  readonly processStore: ProcessStore;
  /** The outbox and inbox retention purge only the process-manager-purge task runs. */
  readonly processManagerPurge: ProcessManagerPurgeRepository;
}
