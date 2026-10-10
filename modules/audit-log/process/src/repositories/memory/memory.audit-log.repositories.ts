import type { AuditLogRepositories } from "../audit-log.repositories.ts";
import { MemoryAuditLogRepository, MemoryAuditLogStore } from "./memory.audit-log.repository.ts";
import { MemoryRecentTouchRepository } from "./memory.recent-touch.repository.ts";

export class MemoryAuditLogRepositories {
  static readonly requires = [] as const;

  static create(): AuditLogRepositories {
    const store = new MemoryAuditLogStore();

    return {
      entries: MemoryAuditLogRepository.create({ store }),
      recentTouches: MemoryRecentTouchRepository.create({ store }),
    };
  }
}
