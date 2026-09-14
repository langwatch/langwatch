import type { CanonicalLogRecord } from "@langwatch/log-contract";

/**
 * Write-only: pipeline appends canonical records here, never reads. {@link
 * CanonicalLogRecordRepository} adds read capability; separate keeps composition honest.
 */
export abstract class CanonicalLogRecordAppendRepository {
  abstract ensureLogRecord(record: CanonicalLogRecord, retentionDays?: number): Promise<void>;

  abstract ensureLogRecords(records: CanonicalLogRecord[], retentionDays?: number): Promise<void>;
}
