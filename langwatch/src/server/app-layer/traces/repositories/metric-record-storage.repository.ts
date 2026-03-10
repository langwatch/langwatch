import type { NormalizedMetricRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/metricRecords";

export interface MetricRecordStorageRepository {
  insertMetricRecord(record: NormalizedMetricRecord): Promise<void>;
}

export class NullMetricRecordStorageRepository
  implements MetricRecordStorageRepository
{
  async insertMetricRecord(_record: NormalizedMetricRecord): Promise<void> {}
}
