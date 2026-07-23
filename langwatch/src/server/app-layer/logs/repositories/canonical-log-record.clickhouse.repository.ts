import { createLogger } from "@langwatch/observability";
import {
  type StoredLogRecordRow,
  TRACE_LOG_READ_CAP,
} from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { CanonicalLogRecord } from "~/server/event-sourcing/pipelines/log-processing/schemas/logRecord";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import type { CanonicalLogRecordRepository } from "./canonical-log-record.repository";

const logger = createLogger(
  "langwatch:app-layer:logs:canonical-log-record-repository",
);
const MAX_UINT64 = 18_446_744_073_709_551_615n;

function dedupVersion(acceptedAt: number): string {
  return (MAX_UINT64 - BigInt(acceptedAt)).toString();
}

function validate(record: CanonicalLogRecord, operation: string) {
  EventUtils.validateTenantId({ tenantId: record.tenantId }, operation);
  if (!/^[a-f0-9]{64}$/.test(record.recordId)) {
    throw new SecurityError(operation, "invalid RecordId", record.tenantId);
  }
}

function groupByTenant(
  records: CanonicalLogRecord[],
): Map<string, CanonicalLogRecord[]> {
  const groups = new Map<string, CanonicalLogRecord[]>();
  for (const record of records) {
    const group = groups.get(record.tenantId) ?? [];
    group.push(record);
    groups.set(record.tenantId, group);
  }
  return groups;
}

function toLogRecordRow({
  record,
  retentionDays,
}: {
  record: CanonicalLogRecord;
  retentionDays: number;
}) {
  return {
    TenantId: record.tenantId,
    RecordId: record.recordId,
    ResourceSchemaUrl: record.resourceSchemaUrl,
    ResourceAttributesJson: record.resourceAttributesJson,
    ResourceAttributesFlatJson: record.resourceAttributesFlatJson,
    ResourceAttributeKeys: record.resourceAttributeKeys,
    ResourceDroppedAttributesCount: record.resourceDroppedAttributesCount,
    ScopeSchemaUrl: record.scopeSchemaUrl,
    ScopeName: record.scopeName,
    ScopeVersion: record.scopeVersion,
    ScopeAttributesJson: record.scopeAttributesJson,
    ScopeAttributeKeys: record.scopeAttributeKeys,
    ScopeDroppedAttributesCount: record.scopeDroppedAttributesCount,
    WireTraceId: record.wireTraceId,
    WireSpanId: record.wireSpanId,
    CorrelationTraceId: record.correlationTraceId,
    CorrelationSpanId: record.correlationSpanId,
    CorrelationSource: record.correlationSource,
    TimeUnixNano: record.timeUnixNano,
    ObservedTimeUnixNano: record.observedTimeUnixNano,
    TimeUnixMs: new Date(record.timeUnixMs),
    SeverityNumber: record.severityNumber,
    SeverityText: record.severityText,
    BodyType: record.bodyType,
    BodyJson: record.bodyJson,
    BodyText: record.bodyText,
    AttributesJson: record.attributesJson,
    AttributesFlatJson: record.attributesFlatJson,
    AttributeKeys: record.attributeKeys,
    DroppedAttributesCount: record.droppedAttributesCount,
    Flags: record.flags,
    EventName: record.eventName,
    ProviderKind: record.providerKind,
    ProviderEventKind: record.providerEventKind,
    ProviderEventSequence: record.providerEventSequence,
    ProviderSessionId: record.providerSessionId,
    ProviderConversationId: record.providerConversationId,
    ProviderPromptId: record.providerPromptId,
    PiiRedactionLevel: record.piiRedactionLevel,
    CanonicalPayload: record.canonicalPayload,
    OccurredAt: new Date(record.occurredAt),
    AcceptedAt: new Date(record.acceptedAt),
    DedupVersion: dedupVersion(record.acceptedAt),
    // Claude's kind-marked rows once expired after a day, because a reactor
    // copied them into spans. That converter is gone: these rows ARE the
    // Terminal transcript's content now, so they live at trace retention
    // like every other log.
    _retention_days: retentionDays,
    _size_bytes: record.canonicalSizeBytes,
  };
}

function toUsageEstimateRow(record: CanonicalLogRecord) {
  return {
    OrganizationId: record.organizationId,
    TenantId: record.tenantId,
    RecordId: record.recordId,
    ProviderKind: record.providerKind,
    AcceptedAt: new Date(record.acceptedAt),
    AcceptedHour: new Date(
      Math.floor(record.acceptedAt / 3_600_000) * 3_600_000,
    ),
    CanonicalSourceBytes: record.canonicalSizeBytes,
    DedupVersion: dedupVersion(record.acceptedAt),
  };
}

export class CanonicalLogRecordClickHouseRepository
  implements CanonicalLogRecordRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async ensureLogRecord(
    record: CanonicalLogRecord,
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    await this.ensureLogRecords([record], retentionDays);
  }

  async ensureLogRecords(
    records: CanonicalLogRecord[],
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    if (records.length === 0) return;
    const byTenant = groupByTenant(records);
    for (const [tenantId, tenantRecords] of byTenant) {
      for (const record of tenantRecords) {
        validate(
          record,
          "CanonicalLogRecordClickHouseRepository.ensureLogRecords",
        );
      }
      const client = await this.resolveClient(tenantId);
      try {
        await client.insert({
          table: "log_records",
          values: tenantRecords.map((record) =>
            toLogRecordRow({ record, retentionDays }),
          ),
          format: "JSONEachRow",
          clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
        });
        await client.insert({
          table: "log_usage_estimates",
          values: tenantRecords.map((record) => toUsageEstimateRow(record)),
          format: "JSONEachRow",
          clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
        });
      } catch (error) {
        logger.error(
          {
            tenantId,
            recordCount: tenantRecords.length,
            recordIds: tenantRecords
              .slice(0, 10)
              .map((record) => record.recordId),
            error,
          },
          "Failed to persist canonical log record batch",
        );
        throw error;
      }
    }
  }

  private window(occurredAtMs?: number) {
    const now = Date.now();
    const center =
      typeof occurredAtMs === "number" && occurredAtMs > 0 ? occurredAtMs : now;
    return {
      from: new Date(center - 14 * 24 * 60 * 60 * 1000),
      to: new Date(center + 2 * 24 * 60 * 60 * 1000),
    };
  }

  async getLogsByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
    limit = TRACE_LOG_READ_CAP,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "CanonicalLogRecordClickHouseRepository.getLogsByTraceId",
    );
    const client = await this.resolveClient(tenantId);
    const { from, to } = this.window(occurredAtMs);
    const result = await client.query({
      query: `
        SELECT
          CorrelationTraceId AS TraceId,
          CorrelationSpanId AS SpanId,
          toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs,
          BodyText,
          AttributesFlatJson,
          ResourceAttributesFlatJson,
          ScopeName,
          ScopeVersion
        FROM log_records FINAL
        WHERE TenantId = {tenantId:String}
          AND CorrelationTraceId = {traceId:String}
          -- Table-qualified: the SELECT aliases toUnixTimestamp64Milli(...) AS
          -- TimeUnixMs, and a bare TimeUnixMs in WHERE resolves to that alias
          -- (epoch millis), never matching a DateTime64 bound.
          AND log_records.TimeUnixMs >= {from:DateTime64(3)}
          AND log_records.TimeUnixMs <= {to:DateTime64(3)}
        ORDER BY TimeUnixNano ASC, RecordId ASC
        LIMIT {limit:UInt64}
      `,
      query_params: { tenantId, traceId, from, to, limit },
      format: "JSONEachRow",
    });
    const rows = await result.json<{
      TraceId: string;
      SpanId: string;
      TimeUnixMs: number | string;
      BodyText: string | null;
      AttributesFlatJson: string;
      ResourceAttributesFlatJson: string;
      ScopeName: string;
      ScopeVersion: string;
    }>();
    if (rows.length >= limit) {
      logger.warn(
        { tenantId, traceId, limit },
        "Canonical trace log read hit its row cap; oldest rows returned, the rest omitted",
      );
    }
    return rows.map((row) => ({
      traceId: row.TraceId,
      spanId: row.SpanId,
      timeUnixMs: Number(row.TimeUnixMs),
      body: row.BodyText ?? "",
      attributes: JSON.parse(row.AttributesFlatJson) as Record<string, string>,
      resourceAttributes: JSON.parse(row.ResourceAttributesFlatJson) as Record<
        string,
        string
      >,
      scopeName: row.ScopeName,
      scopeVersion: row.ScopeVersion || null,
    }));
  }
}
