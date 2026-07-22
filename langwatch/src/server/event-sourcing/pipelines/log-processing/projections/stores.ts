import type { CanonicalLogRecordRepository } from "~/server/event-sourcing/ports/canonical-log-record.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { CanonicalLogRecord } from "../schemas/logRecord";

export class CanonicalLogAppendStore
  implements AppendStore<CanonicalLogRecord>
{
  constructor(private readonly repository: CanonicalLogRecordRepository) {}

  async append(
    record: CanonicalLogRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repository.ensureLogRecord(
      record,
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }

  async bulkAppend(
    records: CanonicalLogRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repository.ensureLogRecords(
      records,
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }
}
