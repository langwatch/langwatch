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
   * passes `cap + 1` so it can both convert the first `cap` and detect that the
   * turn overflowed. Omitted returns the whole turn (historic behaviour).
   */
  getMarkedClaudeCodeLogsByTrace(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<StoredLogRecordRow[]>;
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
  ): Promise<StoredLogRecordRow[]> {
    return [];
  }
}
