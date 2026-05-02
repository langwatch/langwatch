import type { LogRecordStorageRepository } from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { NormalizedLogRecord } from "../schemas/logRecords";

export class LogRecordAppendStore implements AppendStore<NormalizedLogRecord> {
  constructor(private readonly repo: LogRecordStorageRepository) {}

  async append(
    record: NormalizedLogRecord,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.insertLogRecord(record);
  }

  async bulkAppend(
    records: NormalizedLogRecord[],
    _context: ProjectionStoreContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repo.insertLogRecords(records);
  }
}
