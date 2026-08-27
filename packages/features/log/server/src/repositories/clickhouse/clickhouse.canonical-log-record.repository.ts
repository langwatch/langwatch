import { z } from "zod";
import type { ClickHouseSettings, DataFormat } from "@clickhouse/client";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import type { CanonicalLogRecord, CanonicalTraceLogRecord } from "@langwatch/log-contract";
import { createLogger } from "@langwatch/observability";
import { CanonicalLogRecordRepository } from "../canonical-log-record.repository";

export interface LogClickHouseClient {
  insert(params: {
    table: string;
    values: unknown[];
    format?: DataFormat;
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown>;
  query(params: {
    query: string;
    query_params?: Record<string, unknown>;
    format?: DataFormat;
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<{ json(): Promise<unknown[]> }>;
}

type LogClickHouseClientResolver = (tenantId: string) => Promise<LogClickHouseClient>;

const logger = createLogger("langwatch:log:canonical-log-record-repository");
const MAX_UINT64 = 18_446_744_073_709_551_615n;

const traceLogRowSchema = z.object({
  TraceId: z.string(),
  SpanId: z.string(),
  TimeUnixMs: z.union([z.number(), z.string()]),
  BodyText: z.string().nullable(),
  AttributesFlatJson: z.string(),
  ResourceAttributesFlatJson: z.string(),
  ScopeName: z.string(),
  ScopeVersion: z.string(),
  EventName: z.string(),
});

function dedupVersion(acceptedAt: number): string {
  return (MAX_UINT64 - BigInt(acceptedAt)).toString();
}

function validate(record: CanonicalLogRecord, operation: string): void {
  EventUtils.validateTenantId({ tenantId: record.tenantId }, operation);
  if (!/^[a-f0-9]{64}$/.test(record.recordId)) {
    throw new SecurityError(operation, "invalid RecordId", record.tenantId);
  }
}

function groupByTenant(records: CanonicalLogRecord[]): Map<string, CanonicalLogRecord[]> {
  const groups = new Map<string, CanonicalLogRecord[]>();
  for (const record of records) {
    const group = groups.get(record.tenantId) ?? [];
    group.push(record);
    groups.set(record.tenantId, group);
  }
  return groups;
}

function toLogRecordRow(record: CanonicalLogRecord, retentionDays: number) {
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
    AcceptedHour: new Date(Math.floor(record.acceptedAt / 3_600_000) * 3_600_000),
    CanonicalSourceBytes: record.canonicalSizeBytes,
    DedupVersion: dedupVersion(record.acceptedAt),
  };
}

export class ClickHouseCanonicalLogRecordRepository extends CanonicalLogRecordRepository {
  private constructor(
    private readonly resolveClient: LogClickHouseClientResolver,
    private readonly defaultRetentionDays: number,
    private readonly defaultReadLimit: number,
  ) {
    super();
  }

  static create(options: {
    resolveClient: LogClickHouseClientResolver;
    defaultRetentionDays: number;
    defaultReadLimit: number;
  }): ClickHouseCanonicalLogRecordRepository {
    return new ClickHouseCanonicalLogRecordRepository(
      options.resolveClient,
      options.defaultRetentionDays,
      options.defaultReadLimit,
    );
  }

  async ensureLogRecord(
    record: CanonicalLogRecord,
    retentionDays = this.defaultRetentionDays,
  ): Promise<void> {
    await this.ensureLogRecords([record], retentionDays);
  }

  async ensureLogRecords(
    records: CanonicalLogRecord[],
    retentionDays = this.defaultRetentionDays,
  ): Promise<void> {
    if (records.length === 0) return;
    for (const [tenantId, tenantRecords] of groupByTenant(records)) {
      for (const record of tenantRecords) {
        validate(record, "ClickHouseCanonicalLogRecordRepository.ensureLogRecords");
      }
      const client = await this.resolveClient(tenantId);
      try {
        await client.insert({
          table: "log_records",
          values: tenantRecords.map((record) => toLogRecordRow(record, retentionDays)),
          format: "JSONEachRow",
          clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
        });
        await client.insert({
          table: "log_usage_estimates",
          values: tenantRecords.map(toUsageEstimateRow),
          format: "JSONEachRow",
          clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
        });
      } catch (error) {
        logger.warn(
          {
            tenantId,
            recordCount: tenantRecords.length,
            recordIds: tenantRecords.slice(0, 10).map((record) => record.recordId),
            error,
          },
          "Failed to persist canonical log record batch",
        );
        throw error;
      }
    }
  }

  async getLogsByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
    limit = this.defaultReadLimit,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<CanonicalTraceLogRecord[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "ClickHouseCanonicalLogRecordRepository.getLogsByTraceId",
    );
    const center = typeof occurredAtMs === "number" && occurredAtMs > 0 ? occurredAtMs : Date.now();
    const from = new Date(center - 14 * 24 * 60 * 60 * 1000);
    const to = new Date(center + 2 * 24 * 60 * 60 * 1000);
    const client = await this.resolveClient(tenantId);
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
          ScopeVersion,
          EventName
        FROM log_records FINAL
        WHERE TenantId = {tenantId:String}
          AND CorrelationTraceId = {traceId:String}
          AND log_records.TimeUnixMs >= {from:DateTime64(3)}
          AND log_records.TimeUnixMs <= {to:DateTime64(3)}
        ORDER BY TimeUnixNano ASC, RecordId ASC
        LIMIT {limit:UInt64}
      `,
      query_params: { tenantId, traceId, from, to, limit },
      format: "JSONEachRow",
    });
    const rows = z.array(traceLogRowSchema).parse(await result.json());
    if (rows.length >= limit) {
      logger.warn({ tenantId, traceId, limit }, "Canonical trace log read hit its row cap");
    }
    return rows.map((row) => {
      const attributes = z.record(z.string(), z.string()).parse(JSON.parse(row.AttributesFlatJson));
      if (row.EventName && attributes["event.name"] === undefined) {
        attributes["event.name"] = row.EventName;
      }
      return {
        traceId: row.TraceId,
        spanId: row.SpanId,
        timeUnixMs: Number(row.TimeUnixMs),
        body: row.BodyText ?? "",
        attributes,
        resourceAttributes: z
          .record(z.string(), z.string())
          .parse(JSON.parse(row.ResourceAttributesFlatJson)),
        scopeName: row.ScopeName,
        scopeVersion: row.ScopeVersion || null,
      };
    });
  }
}
