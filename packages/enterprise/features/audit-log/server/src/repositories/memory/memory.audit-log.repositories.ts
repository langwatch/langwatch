import type { AuditLogRepositories } from "../audit-log.repositories.ts";
import { MemoryAuditLogRepository } from "./memory.audit-log.repository.ts";

export class MemoryAuditLogRepositories {
  static readonly requires = [] as const;

  static create(): AuditLogRepositories {
    return { entries: MemoryAuditLogRepository.create() };
  }
}
