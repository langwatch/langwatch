import type { CanonicalLogRecord, CanonicalTraceLogRecord } from "@langwatch/log-contract";
import { CanonicalLogRecordRepository } from "../canonical-log-record.repository";

/** No-op persistence used when canonical log storage is disabled. */
export class NullCanonicalLogRecordRepository extends CanonicalLogRecordRepository {
  private constructor() {
    super();
  }

  static create(): NullCanonicalLogRecordRepository {
    return new NullCanonicalLogRecordRepository();
  }

  async ensureLogRecord(_record: CanonicalLogRecord, _retentionDays?: number): Promise<void> {}

  async ensureLogRecords(_records: CanonicalLogRecord[], _retentionDays?: number): Promise<void> {}

  async getLogsByTraceId(_params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<CanonicalTraceLogRecord[]> {
    return [];
  }
}
