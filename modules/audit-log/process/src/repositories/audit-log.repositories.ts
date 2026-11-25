import type { AuditLogRepository } from "./audit-log.repository.ts";
import type { RecentTouchRepository } from "./recent-touch.repository.ts";

export interface AuditLogRepositories {
  readonly entries: AuditLogRepository;
  readonly recentTouches: RecentTouchRepository;
}
