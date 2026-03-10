import type { ClickHouseClient } from "@clickhouse/client";
import type { NormalizedMetricRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/metricRecords";
import { traced } from "../tracing";
import { MetricRecordStorageClickHouseRepository } from "./repositories/metric-record-storage.clickhouse.repository";
import {
  NullMetricRecordStorageRepository,
  type MetricRecordStorageRepository,
} from "./repositories/metric-record-storage.repository";

export class MetricRecordStorageService {
  constructor(readonly repository: MetricRecordStorageRepository) {}

  static create(clickhouse: ClickHouseClient | null): MetricRecordStorageService {
    const repo = clickhouse
      ? new MetricRecordStorageClickHouseRepository(clickhouse)
      : new NullMetricRecordStorageRepository();
    return traced(new MetricRecordStorageService(repo), "MetricRecordStorageService");
  }

  async insertMetricRecord(record: NormalizedMetricRecord): Promise<void> {
    await this.repository.insertMetricRecord(record);
  }
}
