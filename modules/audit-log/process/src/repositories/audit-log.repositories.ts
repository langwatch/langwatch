import type { AgentAuditLogMigrationRepository } from "./agent-audit-log-migration.repository.ts";
import type { AuditLogRepository } from "./audit-log.repository.ts";
import type { RecentTouchRepository } from "./recent-touch.repository.ts";

export interface AuditLogRepositories {
  readonly entries: AuditLogRepository;
  readonly recentTouches: RecentTouchRepository;
  /** The agent audit-log id backfill's reads and patches; see adrs/001. */
  readonly agentAuditLogIds: AgentAuditLogMigrationRepository;
}
