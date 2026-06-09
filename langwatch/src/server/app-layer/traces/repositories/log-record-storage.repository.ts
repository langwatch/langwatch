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
  /**
   * Read the claude_code logs of one trace (turn) that the receiver marked for
   * span synthesis. The span-sync reactor folds these into spans.
   */
  getMarkedClaudeCodeLogsByTrace(
    tenantId: string,
    traceId: string,
  ): Promise<StoredLogRecordRow[]>;
}

export class NullLogRecordStorageRepository
  implements LogRecordStorageRepository
{
  async insertLogRecord(_record: NormalizedLogRecord, _retentionDays?: number): Promise<void> {}
  async getMarkedClaudeCodeLogsByTrace(
    _tenantId: string,
    _traceId: string,
  ): Promise<StoredLogRecordRow[]> {
    return [];
  }
}
