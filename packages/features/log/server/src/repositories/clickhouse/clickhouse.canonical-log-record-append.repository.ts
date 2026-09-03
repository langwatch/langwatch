import type { ClickHouseSettings, DataFormat } from "@clickhouse/client";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { createLogger } from "@langwatch/observability";
import { CanonicalLogRecordAppendRepository } from "../canonical-log-record-append.repository";

export interface LogClickHouseClient {
  insert(params: {
    table: string;
    /**
     * Read-only on purpose: nothing here mutates the batch it is handed, and
     * saying so is what lets a caller holding a `readonly` row array — the
     * Eventing ClickHouse client a background worker composes from — satisfy
     * this port without copying every insert.
     */
    values: readonly unknown[];
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

export type LogClickHouseClientResolver = (tenantId: string) => Promise<LogClickHouseClient>;

const logger = createLogger("langwatch:log:canonical-log-record-repository");
const MAX_UINT64 = 18_446_744_073_709_551_615n;

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

/**
 * The append half of canonical-log persistence, over one tenant-keyed client.
 *
 * Every statement below is tenant-scoped, so one resolver is all it can use.
 * The trace-scoped read and its row cap live with the wider surface, on
 * {@link ClickHouseCanonicalLogRecordRepository}.
 */
export class ClickHouseCanonicalLogRecordAppendRepository extends CanonicalLogRecordAppendRepository {
  private constructor(
    private readonly resolveClient: LogClickHouseClientResolver,
    private readonly defaultRetentionDays: number,
  ) {
    super();
  }

  static create(options: {
    resolveClient: LogClickHouseClientResolver;
    defaultRetentionDays: number;
  }): ClickHouseCanonicalLogRecordAppendRepository {
    return new ClickHouseCanonicalLogRecordAppendRepository(
      options.resolveClient,
      options.defaultRetentionDays,
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
        validate(record, "ClickHouseCanonicalLogRecordAppendRepository.ensureLogRecords");
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
}
