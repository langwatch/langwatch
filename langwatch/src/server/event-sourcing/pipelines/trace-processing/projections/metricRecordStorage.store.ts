import type { MetricRecordStorageRepository } from "~/server/app-layer/traces/repositories/metric-record-storage.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { NormalizedMetricRecord } from "../schemas/metricRecords";

export class MetricRecordAppendStore
  implements AppendStore<NormalizedMetricRecord>
{
  constructor(private readonly repo: MetricRecordStorageRepository) {}

  async append(
    record: NormalizedMetricRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.insertMetricRecord(record, retentionDays);
  }

  async bulkAppend(
    records: NormalizedMetricRecord[],
    _context: ProjectionStoreContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repo.insertMetricRecords(records);
  }
}
