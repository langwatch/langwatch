import type {
  AuditLogEntry,
  AuditLogHistoryEntry,
  ListAuditLogEntityHistoryInput,
  RecordedAuditLogEntry,
  RecordedSinceInput,
} from "@langwatch/audit-log-contract";

export interface AuditLogRepository {
  create(entry: AuditLogEntry): Promise<RecordedAuditLogEntry>;
  findEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]>;
  hasRecordedSince(input: RecordedSinceInput): Promise<boolean>;
}
