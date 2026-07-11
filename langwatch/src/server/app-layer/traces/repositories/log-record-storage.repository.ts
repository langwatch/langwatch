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

export interface LogRecordStorageRepository {
  insertLogRecord(record: NormalizedLogRecord, retentionDays?: number): Promise<void>;
  insertLogRecords(records: NormalizedLogRecord[], retentionDays?: number): Promise<void>;
  /**
   * Read every log record correlated to one trace (generic — not filtered to
   * any emitter). Used by the logs-read API (raw-log inspector, dashboard
   * frontend join) and by the legacy read-path enrichment that joins log
   * content onto real spans. `occurredAtMs` is an optional partition-pruning
   * hint on the `TimeUnixMs` partition key.
   */
  getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
  ): Promise<StoredLogRecordRow[]>;
}

export class NullLogRecordStorageRepository
  implements LogRecordStorageRepository
{
  async insertLogRecord(_record: NormalizedLogRecord, _retentionDays?: number): Promise<void> {}
  async insertLogRecords(_records: NormalizedLogRecord[], _retentionDays?: number): Promise<void> {}
  async getLogsByTraceId(
    _tenantId: string,
    _traceId: string,
    _occurredAtMs?: number,
  ): Promise<StoredLogRecordRow[]> {
    return [];
  }
}
