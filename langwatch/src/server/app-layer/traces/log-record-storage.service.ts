import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import type {
  LogRecordStorageRepository,
  StoredLogRecordRow,
} from "./repositories/log-record-storage.repository";

export class LogRecordStorageService {
  constructor(readonly repository: LogRecordStorageRepository) {}

  async insertLogRecord(record: NormalizedLogRecord): Promise<void> {
    await this.repository.insertLogRecord(record);
  }

  /**
   * Read every log record correlated to one trace (generic across emitters).
   * `occurredAtMs` is an optional partition-pruning hint on the `TimeUnixMs`
   * partition key. Powers the logs-read API (raw-log inspector, dashboard
   * frontend join) and the legacy read-path Claude Code content enrichment.
   */
  async getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
  ): Promise<StoredLogRecordRow[]> {
    return this.repository.getLogsByTraceId(tenantId, traceId, occurredAtMs);
  }
}
