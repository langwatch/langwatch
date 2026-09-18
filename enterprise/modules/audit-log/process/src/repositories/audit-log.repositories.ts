import type { AuditLogRepository } from "./audit-log.repository.ts";

export interface AuditLogRepositories {
  readonly entries: AuditLogRepository;
}
