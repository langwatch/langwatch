import type { AuditLogEntry } from "@langwatch/enterprise-audit-log-contract";

export abstract class AuditLogRepository {
  abstract create(entry: AuditLogEntry): Promise<void>;
}
