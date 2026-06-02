import type { LogRecordStorageRepository } from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { NormalizedLogRecord } from "../schemas/logRecords";

export class LogRecordAppendStore implements AppendStore<NormalizedLogRecord> {
  constructor(private readonly repo: LogRecordStorageRepository) {}

  async append(
    record: NormalizedLogRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.insertLogRecord(record, retentionDays);
  }
}
