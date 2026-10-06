import type {
  AuditLogEntry,
  AuditLogHistoryEntry,
  ListAuditLogEntityHistoryInput,
  RecordedAuditLogEntry,
  RecordedSinceInput,
} from "@langwatch/audit-log-contract";

export interface AuditLogRepository {
  create(entry: AuditLogEntry): Promise<RecordedAuditLogEntry>;
  /** Writes the row under `id` unless one exists; either way answers the stored row. */
  createOnce(keyed: {
    entry: AuditLogEntry;
    id: string;
    occurredAt: number;
  }): Promise<RecordedAuditLogEntry>;
  findEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]>;
  hasRecordedSince(input: RecordedSinceInput): Promise<boolean>;
}
