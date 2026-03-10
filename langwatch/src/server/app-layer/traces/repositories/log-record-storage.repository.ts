import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";

export interface LogRecordStorageRepository {
  insertLogRecord(record: NormalizedLogRecord): Promise<void>;
}

export class NullLogRecordStorageRepository
  implements LogRecordStorageRepository
{
  async insertLogRecord(_record: NormalizedLogRecord): Promise<void> {}
}
