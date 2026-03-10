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
    _context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.insertMetricRecord(record);
  }
}
