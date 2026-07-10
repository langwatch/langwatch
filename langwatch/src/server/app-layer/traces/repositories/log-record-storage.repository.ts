import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";

/**
 * A stored log record read back by trace, as the claude span-sync reactor needs
 * it: the attribute map (carrying the event payload `body`, model, tokens, …)
 * plus the resource/scope so the derived spans keep their provenance.
 */
export interface StoredLogRecordRow {
  traceId: string;
  spanId: string;
  timeUnixMs: number;
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  scopeName: string;
  scopeVersion: string | null;
}

export interface LogRecordStorageRepository {
  insertLogRecord(record: NormalizedLogRecord, retentionDays?: number): Promise<void>;
  insertLogRecords(records: NormalizedLogRecord[], retentionDays?: number): Promise<void>;
  /**
   * Read the claude_code logs of one trace (turn) that the receiver marked for
   * span synthesis. The span-sync reactor folds these into spans.
   *
   * `limit` bounds how many records are returned (in turn order); the reactor
   * fetches one batch of `cap` records per pass. Omitted returns the whole turn.
   *
   * `afterKey` fetches only records strictly after a `(TimeUnixMs, event.sequence)`
   * order key, consistent with the ORDER BY, so the reactor can page through a
   * turn one bounded batch at a time (incremental conversion) — each pass reads
   * only the records it has not converted yet. Omitted starts from the turn's
   * first record.
   */
  getMarkedClaudeCodeLogsByTrace(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
    afterKey?: { timeUnixMs: number; sequence: number },
  ): Promise<StoredLogRecordRow[]>;
  /**
   * Count the trace's (turn's) marked claude_code logs the same way
   * {@link getMarkedClaudeCodeLogsByTrace} selects them, but uncapped. The
   * span-sync reactor calls this only when a turn overflows the per-turn cap, so
   * it can stamp the TRUE dropped-log count instead of the `cap + 1` lower bound.
   */
  countMarkedClaudeCodeLogsByTrace(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
  ): Promise<number>;
}

export class NullLogRecordStorageRepository
  implements LogRecordStorageRepository
{
  async insertLogRecord(_record: NormalizedLogRecord, _retentionDays?: number): Promise<void> {}
  async insertLogRecords(_records: NormalizedLogRecord[], _retentionDays?: number): Promise<void> {}
  async getMarkedClaudeCodeLogsByTrace(
    _tenantId: string,
    _traceId: string,
    _occurredAtMs?: number,
    _limit?: number,
    _afterKey?: { timeUnixMs: number; sequence: number },
  ): Promise<StoredLogRecordRow[]> {
    return [];
  }
  async countMarkedClaudeCodeLogsByTrace(
    _tenantId: string,
    _traceId: string,
    _occurredAtMs?: number,
  ): Promise<number> {
    return 0;
  }
}
