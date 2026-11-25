import type {
  AuditLogEntry,
  AuditLogExportEntry,
  FindAuditLogForOrganizationInput,
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
  /** Oldest first after the `(createdAt, id)` watermark, at most `limit`. */
  findForOrganization(input: FindAuditLogForOrganizationInput): Promise<AuditLogExportEntry[]>;
}
