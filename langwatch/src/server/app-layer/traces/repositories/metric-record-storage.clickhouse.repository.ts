import type { ClickHouseClient } from "@clickhouse/client";
import type { NormalizedMetricRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/metricRecords";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { MetricRecordStorageRepository } from "./metric-record-storage.repository";

const TABLE_NAME = "stored_metric_records" as const;

const logger = createLogger(
  "langwatch:app-layer:traces:metric-record-storage-repository",
);

export class MetricRecordStorageClickHouseRepository
  implements MetricRecordStorageRepository
{
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async insertMetricRecord(record: NormalizedMetricRecord): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: record.tenantId },
      "MetricRecordStorageClickHouseRepository.insertMetricRecord",
    );

    try {
      const now = new Date();
      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: [
          {
            ProjectionId: record.id,
            TenantId: record.tenantId,
            TraceId: record.traceId,
            SpanId: record.spanId,
            MetricName: record.metricName,
            MetricUnit: record.metricUnit,
            MetricType: record.metricType,
            Value: record.value,
            TimeUnixMs: new Date(record.timeUnixMs),
            Attributes: record.attributes,
            ResourceAttributes: record.resourceAttributes,
            CreatedAt: now,
            UpdatedAt: now,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId: record.tenantId,
          traceId: record.traceId,
          spanId: record.spanId,
          metricName: record.metricName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert metric record into ClickHouse",
      );
      throw error;
    }
  }
}
