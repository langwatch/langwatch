import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";

/** Optional partition-pruning hint: the trace's approximate occurrence time. */
export interface LogRecordOccurredAtHint {
  occurredAtMs?: number;
}

/**
 * Hard cap on log records read per trace. A runaway/agent-loop session can land
 * thousands of log records on one trace_id (same incident-class shape as the
 * spans-per-trace ingestion bound). The reader returns at most this many rows
 * plus the true `totalCount`, so the projector can render a bounded waterfall
 * and surface how many records were elided. 30x headroom over the ~34 records a
 * normal claude-code session emits.
 */
export const MAX_LOG_RECORDS_PER_TRACE_READ = 1000;

export interface LogRecordsForTrace {
  /** Up to MAX_LOG_RECORDS_PER_TRACE_READ records, ordered by time ascending. */
  records: NormalizedLogRecord[];
  /** Total records on the trace (may exceed `records.length` when capped). */
  totalCount: number;
}

export interface LogRecordStorageRepository {
  insertLogRecord(record: NormalizedLogRecord, retentionDays?: number): Promise<void>;
  /**
   * Read up to MAX_LOG_RECORDS_PER_TRACE_READ log records for a single trace,
   * ordered by time, plus the true total count. Read-only — used by the v2
   * drawer to project display spans for log-only traces (e.g. Claude Code OTLP,
   * which emits log records, not spans).
   */
  findByTraceId(
    params: { tenantId: string; traceId: string } & LogRecordOccurredAtHint,
  ): Promise<LogRecordsForTrace>;
}

export class NullLogRecordStorageRepository
  implements LogRecordStorageRepository
{
  async insertLogRecord(_record: NormalizedLogRecord, _retentionDays?: number): Promise<void> {}
  async findByTraceId(
    _params: { tenantId: string; traceId: string } & LogRecordOccurredAtHint,
  ): Promise<LogRecordsForTrace> {
    return { records: [], totalCount: 0 };
  }
}
