import type { CanonicalLogRecord } from "@langwatch/log-contract";

/** The pipeline appends canonical records here; trace owns the record reads. */
export abstract class CanonicalLogRecordAppendRepository {
  abstract ensureLogRecord(record: CanonicalLogRecord, retentionDays?: number): Promise<void>;

  abstract ensureLogRecords(records: CanonicalLogRecord[], retentionDays?: number): Promise<void>;

  /** One tenant's stored bytes over its log records, every stored row counted. */
  abstract getStoredBytes(input: { tenantId: string }): Promise<number>;
}
