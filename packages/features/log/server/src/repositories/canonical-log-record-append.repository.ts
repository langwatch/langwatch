import type { CanonicalLogRecord } from "@langwatch/log-contract";

/**
 * The two calls durable log processing makes, and nothing else.
 *
 * The pipeline's one map projection appends canonical records through this
 * port; it never reads one back. The read that {@link CanonicalLogRecordRepository}
 * adds carries the trace-scoped row cap a query graph needs and a queue
 * consumer has no use for, and a process handed a cap it never consults is a
 * process whose composition claims something untrue about it.
 */
export abstract class CanonicalLogRecordAppendRepository {
  abstract ensureLogRecord(record: CanonicalLogRecord, retentionDays?: number): Promise<void>;

  abstract ensureLogRecords(records: CanonicalLogRecord[], retentionDays?: number): Promise<void>;
}
