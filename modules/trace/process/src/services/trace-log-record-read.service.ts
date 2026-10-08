import {
  LogRecordStorageRepository,
  type StoredLogRecordRow,
} from "../repositories/log-record-storage.repository.ts";

/**
 * The trace-correlated log read over trace's own `stored_log_records`: pre-cutover rows, and
 * every record since, mapped there from log's record fact by trace_log_records (D-LOG).
 */
export class LogRecordStorageService {
  static create(options: { repository: LogRecordStorageRepository }): LogRecordStorageService {
    return new LogRecordStorageService(options);
  }

  readonly repository: LogRecordStorageRepository;

  private constructor({ repository }: { repository: LogRecordStorageRepository }) {
    this.repository = repository;
  }

  /**
   * Every log record correlated to one trace, oldest first, capped at `limit` rows. `occurredAtMs`
   * is an optional partition-pruning hint on the `TimeUnixMs` partition key. Powers the logs-read
   * API and the read-path Claude Code content enrichment.
   */
  async getLogsByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
    limit,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]> {
    const rows = await this.repository.findLogsByTraceId({
      tenantId,
      traceId,
      occurredAtMs,
      limit,
    });
    // A record written by the pre-cutover writer and mapped again carries two ProjectionIds.
    return LogRecordStorageRepository.mergeStoredLogRows(rows, limit);
  }
}
