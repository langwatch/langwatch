import type {
  AuditLogEntry,
  AuditLogHistoryEntry,
  ListAuditLogEntityHistoryInput,
} from "@langwatch/audit-log-contract";

export interface AuditLogRepository {
  create(entry: AuditLogEntry): Promise<void>;
  findEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]>;
}
