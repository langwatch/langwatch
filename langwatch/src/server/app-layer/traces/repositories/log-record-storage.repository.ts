import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";

/**
 * A stored log record read back by trace. Generic across emitters (Claude Code,
 * Spring AI, codex, gemini, …): logs correlate at the TRACE level, and the raw
 * body + attribute map carry whatever the emitter put there (event payload,
 * event name, request id, cost). The resource/scope ride along so a reader keeps
 * the log's provenance.
 */
export interface StoredLogRecordRow {
  traceId: string;
  spanId: string;
  timeUnixMs: number;
  /** The OTLP LogRecord body (a summary/marker for many emitters; content-of-record for some). */
  body: string;
  /** The log record's attribute map — carries the event payload (`body`), `event.name`, `request_id`, `cost_usd`, … */
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  scopeName: string;
  scopeVersion: string | null;
}

/**
 * Ceiling on how many log rows one trace read materialises. Every row carries
 * the heavy `Body` (a raw `api_*_body` payload runs to 60 KB), so an unbounded
 * read of a marathon session re-opens the fat-payload memory failure mode the
 * ingest side is hardened against — and an OOM is not catchable by the
 * callers' best-effort try/catch. 2000 rows ≈ several hundred model calls,
 * comfortably past any real session; a trace past the cap gets its
 * time-earliest rows and the repository warns.
 */
export const TRACE_LOG_READ_CAP = 2000;

export interface LogRecordStorageRepository {
  insertLogRecord(
    record: NormalizedLogRecord,
    retentionDays?: number,
  ): Promise<void>;
  insertLogRecords(
    records: NormalizedLogRecord[],
    retentionDays?: number,
  ): Promise<void>;
  /**
   * Read every log record correlated to one trace (generic — not filtered to
   * any emitter), oldest first, capped at `limit` rows
   * ({@link TRACE_LOG_READ_CAP} unless the caller narrows it). Used by the
   * logs-read API (raw-log inspector, dashboard frontend join) and by the
   * legacy read-path enrichment that joins log content onto real spans.
   * `occurredAtMs` is an optional partition-pruning hint on the `TimeUnixMs`
   * partition key.
   */
  getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<StoredLogRecordRow[]>;
}

/**
 * Dedup + time-order rows read from BOTH log stores during the canonical
 * cutover. Legacy rows preserve OTLP insertion order while canonical rows
 * are key-sorted (stableStringify), so attribute keys are sorted before
 * serialising or the same record could produce two different identities and
 * slip past the dedup.
 */
export function mergeStoredLogRows(
  rows: StoredLogRecordRow[],
  limit?: number,
): StoredLogRecordRow[] {
  const deduped = new Map<string, StoredLogRecordRow>();
  for (const row of rows) {
    const key = [
      row.traceId,
      row.spanId,
      row.timeUnixMs,
      row.scopeName,
      JSON.stringify(Object.fromEntries(Object.entries(row.attributes).sort())),
    ].join("\0");
    deduped.set(key, row);
  }
  const sorted = [...deduped.values()].sort(
    (left, right) => left.timeUnixMs - right.timeUnixMs,
  );
  return typeof limit === "number" && limit > 0
    ? sorted.slice(0, limit)
    : sorted;
}

export class NullLogRecordStorageRepository
  implements LogRecordStorageRepository
{
  async insertLogRecord(
    _record: NormalizedLogRecord,
    _retentionDays?: number,
  ): Promise<void> {
    // No-op store: log records are dropped when ClickHouse is disabled.
  }
  async insertLogRecords(
    _records: NormalizedLogRecord[],
    _retentionDays?: number,
  ): Promise<void> {
    // No-op store: log records are dropped when ClickHouse is disabled.
  }
  async getLogsByTraceId(
    _tenantId: string,
    _traceId: string,
    _occurredAtMs?: number,
    _limit?: number,
  ): Promise<StoredLogRecordRow[]> {
    return [];
  }
}
