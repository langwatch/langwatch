import type { MetricRecordStorageRepository } from "~/server/app-layer/traces/repositories/metric-record-storage.repository";
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
    const retentionDays = context.retentionPolicy?.traces ?? 0;
    await this.repo.insertMetricRecord(record, retentionDays);
  }
}
