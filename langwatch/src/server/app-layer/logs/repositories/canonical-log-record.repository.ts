import type { StoredLogRecordRow } from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import type { CanonicalLogRecord } from "~/server/event-sourcing/pipelines/log-processing/schemas/logRecord";

export interface CanonicalLogRecordRepository {
  ensureLogRecord(
    record: CanonicalLogRecord,
    retentionDays?: number,
  ): Promise<void>;
  ensureLogRecords(
    records: CanonicalLogRecord[],
    retentionDays?: number,
  ): Promise<void>;
  /**
   * Every canonical log record correlated to one trace (generic — no
   * provider filter), oldest first, capped. The transcript derivation and
   * the drawer's log reads live on this; the trace-drill sort key
   * `(TenantId, CorrelationTraceId, TimeUnixMs, RecordId)` is built for it.
   */
  getLogsByTraceId(params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]>;
}

export class NullCanonicalLogRecordRepository
  implements CanonicalLogRecordRepository
{
  async ensureLogRecord(
    _record: CanonicalLogRecord,
    _retentionDays?: number,
  ): Promise<void> {
    return;
  }

  async ensureLogRecords(
    _records: CanonicalLogRecord[],
    _retentionDays?: number,
  ): Promise<void> {
    return;
  }

  async getLogsByTraceId(_params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]> {
    return [];
  }
}
