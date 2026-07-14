import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import type { LogRecordStorageRepository } from "./repositories/log-record-storage.repository";

export class LogRecordStorageService {
  constructor(readonly repository: LogRecordStorageRepository) {}

  async insertLogRecord(record: NormalizedLogRecord): Promise<void> {
    await this.repository.insertLogRecord(record);
  }
}
