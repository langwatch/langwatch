import type { NormalizedMetricRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/metricRecords";
import type { MetricRecordStorageRepository } from "./repositories/metric-record-storage.repository";

export class MetricRecordStorageService {
  constructor(readonly repository: MetricRecordStorageRepository) {}

  async insertMetricRecord(record: NormalizedMetricRecord): Promise<void> {
    await this.repository.insertMetricRecord(record);
  }
}
