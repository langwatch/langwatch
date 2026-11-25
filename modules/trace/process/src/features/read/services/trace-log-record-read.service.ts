import {
  LogRecordStorageRepository,
  type StoredLogRecordRow,
} from "../../../repositories/log-record-storage.repository.ts";

/**
 * The trace-correlated log read: log's `log_records`, read through log's share, and the legacy
 * `stored_log_records` a release before the cutover wrote, read until those rows age out.
 * Spec: modules/trace/specs/trace-log-record-read.feature
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
    const query = { tenantId, traceId, occurredAtMs, limit };
    const [legacy, logRecords] = await Promise.all([
      this.repository.findLogsByTraceId(query),
      this.repository.findLogRecordsByTraceId(query),
    ]);
    // Log's own row goes last, so it wins a record both stores hold.
    return LogRecordStorageRepository.mergeStoredLogRows([...legacy, ...logRecords], limit);
  }
}
