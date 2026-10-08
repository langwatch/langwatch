import type {
  AuditLogEntry,
  AuditLogHistoryEntry,
  AuditLogTargetEntry,
  FindAuditLogByTargetKindInput,
  ListAuditLogEntityHistoryInput,
  RecordedAuditLogEntry,
  RecordedSinceInput,
} from "@langwatch/audit-log-contract";

export interface AuditLogRepository {
  create(entry: AuditLogEntry): Promise<RecordedAuditLogEntry>;
  /** Writes the row unless one holds `idempotencyKey`; either way answers the stored row. */
  createOnce(keyed: {
    entry: AuditLogEntry;
    idempotencyKey: string;
    occurredAt: number;
  }): Promise<RecordedAuditLogEntry>;
  findEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]>;
  hasRecordedSince(input: RecordedSinceInput): Promise<boolean>;
  /** Newest first, at most `limit`. */
  findByTargetKind(input: FindAuditLogByTargetKindInput): Promise<AuditLogTargetEntry[]>;
}
