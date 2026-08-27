import type { CanonicalLogRecord, CanonicalTraceLogRecord } from "@langwatch/log-contract";

export abstract class CanonicalLogRecordRepository {
  abstract ensureLogRecord(record: CanonicalLogRecord, retentionDays?: number): Promise<void>;

  abstract ensureLogRecords(records: CanonicalLogRecord[], retentionDays?: number): Promise<void>;

  abstract getLogsByTraceId(params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<CanonicalTraceLogRecord[]>;
}
