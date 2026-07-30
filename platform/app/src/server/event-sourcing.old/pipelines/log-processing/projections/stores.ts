import type { CanonicalLogRecordRepository } from "~/server/app-layer/logs/repositories/canonical-log-record.repository";
import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import { retentionDaysFrom } from "../../shared/analyticsStoreBase";
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
      retentionDaysFrom(context, "traces"),
    );
  }

  async bulkAppend(
    records: CanonicalLogRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repository.ensureLogRecords(
      records,
      retentionDaysFrom(context, "traces"),
    );
  }
}
