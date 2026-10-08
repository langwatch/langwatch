import type { CanonicalTraceLogRecord } from "@langwatch/log-contract";

/** Stored log record read by trace: log's trace-correlated read shape. */
export type StoredLogRecordRow = CanonicalTraceLogRecord;

/** One `stored_log_records` row trace writes from log's record fact, keyed by its record id. */
export type StoredLogRecordWrite = StoredLogRecordRow & {
  tenantId: string;
  recordId: string;
  severityNumber: number;
  severityText: string;
  acceptedAtMs: number;
};

// Ceiling on log rows one trace read materialises to avoid OOM in marathon sessions.
export const TRACE_LOG_READ_CAP = 2000;

export abstract class LogRecordStorageRepository {
  /**
   * Reads every log record correlated to one trace, oldest first, capped at
   * {@link TRACE_LOG_READ_CAP} unless narrowed. Optional occurredAtMs hint enables
   * partition pruning on TimeUnixMs.
   */
  abstract findLogsByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
    limit,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]>;

  /** Writes rows; idempotent per record, so a redelivered or replayed fact changes nothing. */
  abstract insertLogRecords({
    records,
    retentionDays,
  }: {
    records: readonly StoredLogRecordWrite[];
    retentionDays: number;
  }): Promise<void>;

  /**
   * Dedup and time-order rows read from both log stores during canonical cutover.
   * Attribute keys are sorted before serializing to ensure consistent identity.
   */
  static mergeStoredLogRows(rows: StoredLogRecordRow[], limit?: number): StoredLogRecordRow[] {
    const deduped = new Map<string, StoredLogRecordRow>();
    for (const row of rows) {
      const key = [
        row.traceId,
        row.spanId,
        row.timeUnixMs,
        row.scopeName,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(row.attributes).toSorted(([a], [b]) => (a < b ? -1 : Number(a > b))),
          ),
        ),
      ].join("\0");
      deduped.set(key, row);
    }
    const sorted = [...deduped.values()].toSorted(
      (left, right) => left.timeUnixMs - right.timeUnixMs,
    );
    return typeof limit === "number" && limit > 0 ? sorted.slice(0, limit) : sorted;
  }
}

export class NullLogRecordStorageRepository implements LogRecordStorageRepository {
  async findLogsByTraceId(_params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]> {
    return [];
  }

  async insertLogRecords(_params: {
    records: readonly StoredLogRecordWrite[];
    retentionDays: number;
  }): Promise<void> {}
}
