import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import type {
  LogRecordOccurredAtHint,
  LogRecordsForTrace,
  LogRecordStorageRepository,
} from "./repositories/log-record-storage.repository";

export class LogRecordStorageService {
  constructor(readonly repository: LogRecordStorageRepository) {}

  async insertLogRecord(record: NormalizedLogRecord): Promise<void> {
    await this.repository.insertLogRecord(record);
  }

  /**
   * Read a single trace's log records (bounded + counted) for read-time span
   * projection in the v2 drawer. Read-only — never writes spans or fold state.
   */
  async getByTraceId(
    params: { tenantId: string; traceId: string } & LogRecordOccurredAtHint,
  ): Promise<LogRecordsForTrace> {
    return this.repository.findByTraceId(params);
  }
}
