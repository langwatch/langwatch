import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { LogRecordStorageRepository } from "./log-record-storage.repository";

const TABLE_NAME = "stored_log_records" as const;

const logger = createLogger(
  "langwatch:app-layer:traces:log-record-storage-repository",
);

export class LogRecordStorageClickHouseRepository
  implements LogRecordStorageRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertLogRecord(record: NormalizedLogRecord): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: record.tenantId },
      "LogRecordStorageClickHouseRepository.insertLogRecord",
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
            TimeUnixMs: new Date(record.timeUnixMs),
            SeverityNumber: record.severityNumber,
            SeverityText: record.severityText,
            Body: record.body,
            Attributes: record.attributes,
            ResourceAttributes: record.resourceAttributes,
            ScopeName: record.scopeName,
            ScopeVersion: record.scopeVersion,
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
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert log record into ClickHouse",
      );
      throw error;
    }
  }

  async insertLogRecords(records: NormalizedLogRecord[]): Promise<void> {
    if (records.length === 0) return;

    for (const record of records) {
      EventUtils.validateTenantId(
        { tenantId: record.tenantId },
        "LogRecordStorageClickHouseRepository.insertLogRecords",
      );
    }

    const tenantId = records[0]!.tenantId;
    for (const record of records) {
      if (record.tenantId !== tenantId) {
        throw new SecurityError(
          "LogRecordStorageClickHouseRepository.insertLogRecords",
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
        TimeUnixMs: new Date(record.timeUnixMs),
        SeverityNumber: record.severityNumber,
        SeverityText: record.severityText,
        Body: record.body,
        Attributes: record.attributes,
        ResourceAttributes: record.resourceAttributes,
        ScopeName: record.scopeName,
        ScopeVersion: record.scopeVersion,
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
        "Failed to bulk insert log records into ClickHouse",
      );
      throw error;
    }
  }
}
