import {
  LogRecordStorageRepository,
  type StoredLogRecordRow,
  type StoredLogRecordWrite,
  TRACE_LOG_READ_CAP,
} from "../log-record-storage.repository.ts";

/** In-memory `stored_log_records`: one row per tenant and record id, as its ReplacingMergeTree. */
export class MemoryLogRecordStorageRepository extends LogRecordStorageRepository {
  static create(): MemoryLogRecordStorageRepository {
    return new MemoryLogRecordStorageRepository();
  }

  private readonly rows = new Map<string, StoredLogRecordWrite & { retentionDays: number }>();

  async insertLogRecords({
    records,
    retentionDays,
  }: {
    records: readonly StoredLogRecordWrite[];
    retentionDays: number;
  }): Promise<void> {
    for (const record of records) {
      this.rows.set(`${record.tenantId}\0${record.recordId}`, { ...record, retentionDays });
    }
  }

  async findLogsByTraceId({
    tenantId,
    traceId,
    limit = TRACE_LOG_READ_CAP,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.tenantId === tenantId && row.traceId === traceId)
      .toSorted((left, right) => left.timeUnixMs - right.timeUnixMs)
      .slice(0, limit)
      .map((row) => ({
        traceId: row.traceId,
        spanId: row.spanId,
        timeUnixMs: row.timeUnixMs,
        body: row.body,
        attributes: row.attributes,
        resourceAttributes: row.resourceAttributes,
        scopeName: row.scopeName,
        scopeVersion: row.scopeVersion,
      }));
  }

  /** Every stored row with the retention it was stamped with, for assertions. */
  storedRows(): readonly (StoredLogRecordWrite & { retentionDays: number })[] {
    return [...this.rows.values()];
  }
}
