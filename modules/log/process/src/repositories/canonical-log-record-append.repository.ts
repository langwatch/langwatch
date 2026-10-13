import type { CanonicalLogRecord } from "@langwatch/log-contract";

/** Write-only: the pipeline appends canonical records here; trace owns the reads. */
export abstract class CanonicalLogRecordAppendRepository {
  abstract ensureLogRecord(record: CanonicalLogRecord, retentionDays?: number): Promise<void>;

  abstract ensureLogRecords(records: CanonicalLogRecord[], retentionDays?: number): Promise<void>;
}
