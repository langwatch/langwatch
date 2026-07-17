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
  getMarkedClaudeCodeLogsByTrace(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<StoredLogRecordRow[]>;
  countMarkedClaudeCodeLogsByTrace(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
  ): Promise<number>;
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

  async getMarkedClaudeCodeLogsByTrace(
    _tenantId: string,
    _traceId: string,
    _occurredAtMs?: number,
    _limit?: number,
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
