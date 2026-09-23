/**
 * Stored log record read by trace. Generic across emitters; correlates at
 * TRACE level. Body and attributes carry emitter data; resource/scope provide provenance.
 */
export interface StoredLogRecordRow {
  traceId: string;
  spanId: string;
  timeUnixMs: number;
  /** The OTLP LogRecord body (a summary/marker for many emitters; content-of-record for some). */
  body: string;
  /** Attribute map carrying event payload, event.name, request_id, cost_usd, etc. */
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  scopeName: string;
  scopeVersion: string | null;
}

// Ceiling on log rows one trace read materialises to avoid OOM in marathon sessions.
export const TRACE_LOG_READ_CAP = 2000;

export abstract class LogRecordStorageRepository {
  /**
   * Reads every log record correlated to one trace, oldest first, capped at
   * {@link TRACE_LOG_READ_CAP} unless narrowed. Optional occurredAtMs hint enables
   * partition pruning on TimeUnixMs.
   */
  abstract findLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<StoredLogRecordRow[]>;
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
  async findLogsByTraceId(
    _tenantId: string,
    _traceId: string,
    _occurredAtMs?: number,
    _limit?: number,
  ): Promise<StoredLogRecordRow[]> {
    return [];
  }
}
