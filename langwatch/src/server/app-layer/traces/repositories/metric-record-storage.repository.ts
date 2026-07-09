import type { NormalizedMetricRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/metricRecords";

export interface MetricRecordStorageRepository {
  insertMetricRecord(record: NormalizedMetricRecord, retentionDays?: number): Promise<void>;
  insertMetricRecords(records: NormalizedMetricRecord[], retentionDays?: number): Promise<void>;
}

export class NullMetricRecordStorageRepository
  implements MetricRecordStorageRepository
{
  async insertMetricRecord(_record: NormalizedMetricRecord, _retentionDays?: number): Promise<void> {}
  async insertMetricRecords(_records: NormalizedMetricRecord[], _retentionDays?: number): Promise<void> {}
}
