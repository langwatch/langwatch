import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { NormalizedMetricRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/metricRecords";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
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
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertMetricRecord(record: NormalizedMetricRecord): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: record.tenantId },
      "MetricRecordStorageClickHouseRepository.insertMetricRecord",
    );

    try {
      const client = await this.resolveClient(record.tenantId);
      const now = new Date();
      await client.insert({
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

  async insertMetricRecords(records: NormalizedMetricRecord[]): Promise<void> {
    if (records.length === 0) return;

    for (const record of records) {
      EventUtils.validateTenantId(
        { tenantId: record.tenantId },
        "MetricRecordStorageClickHouseRepository.insertMetricRecords",
      );
    }

    const tenantId = records[0]!.tenantId;
    for (const record of records) {
      if (record.tenantId !== tenantId) {
        throw new SecurityError(
          "MetricRecordStorageClickHouseRepository.insertMetricRecords",
          "all records in a single batch must share the same tenantId",
          tenantId,
          { mismatchedTenantId: record.tenantId },
        );
      }
    }

    try {
      const client = await this.resolveClient(tenantId);
      const now = new Date();
      const values = records.map((record) => ({
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
      }));

      await client.insert({
        table: TABLE_NAME,
        values,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          count: records.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to bulk insert metric records into ClickHouse",
      );
      throw error;
    }
  }
}
