import { createLogger } from "@langwatch/observability";
import {
  CLAUDE_CODE_KIND_ATTR,
  CLAUDE_CODE_LOG_RETENTION_DAYS,
} from "~/server/app-layer/traces/claude-code-log-to-span";
import type { StoredLogRecordRow } from "~/server/event-sourcing/ports/log-record-storage.repository";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { CanonicalLogRecord } from "~/server/event-sourcing/pipelines/log-processing/schemas/logRecord";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import type { CanonicalLogRecordRepository } from "~/server/event-sourcing/ports/canonical-log-record.repository";

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

/**
 * Raw claude_code logs the span fold consumes become pure duplication once
 * claudeCodeSpanSync folds them into stored_spans, so they are evicted far
 * sooner than the platform default (the spans inherit the real retention).
 *
 * Stamped, not min'd against the caller's value, so an indefinite (0) project
 * retention cannot make a fold-intermediate log live forever. This mirrors the
 * legacy log-record-storage repository; canonical logs replace that table, so
 * dropping the cap here would silently retain every folded Claude Code log at
 * full trace retention from the cutover onwards.
 */
function retentionDaysFor(
  record: CanonicalLogRecord,
  retentionDays: number,
): number {
  return record.attributeKeys.includes(CLAUDE_CODE_KIND_ATTR)
    ? CLAUDE_CODE_LOG_RETENTION_DAYS
    : retentionDays;
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
    _retention_days: retentionDaysFor(record, retentionDays),
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

  async getMarkedClaudeCodeLogsByTrace({
    tenantId,
    traceId,
    occurredAtMs,
    limit,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "CanonicalLogRecordClickHouseRepository.getMarkedClaudeCodeLogsByTrace",
    );
    const client = await this.resolveClient(tenantId);
    const { from, to } = this.window(occurredAtMs);
    const hasLimit = typeof limit === "number" && limit > 0;
    const result = await client.query({
      query: `
        SELECT
          CorrelationTraceId AS TraceId,
          CorrelationSpanId AS SpanId,
          toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs,
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
          AND ProviderKind = 'claude_code'
          AND ProviderEventKind != ''
        ORDER BY TimeUnixNano ASC, ProviderEventSequence ASC, RecordId ASC
        ${hasLimit ? "LIMIT {limit:UInt64}" : ""}
      `,
      query_params: {
        tenantId,
        traceId,
        from,
        to,
        ...(hasLimit ? { limit } : {}),
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<{
      TraceId: string;
      SpanId: string;
      TimeUnixMs: number | string;
      AttributesFlatJson: string;
      ResourceAttributesFlatJson: string;
      ScopeName: string;
      ScopeVersion: string;
    }>();
    return rows.map((row) => ({
      traceId: row.TraceId,
      spanId: row.SpanId,
      timeUnixMs: Number(row.TimeUnixMs),
      attributes: JSON.parse(row.AttributesFlatJson) as Record<string, string>,
      resourceAttributes: JSON.parse(row.ResourceAttributesFlatJson) as Record<
        string,
        string
      >,
      scopeName: row.ScopeName,
      scopeVersion: row.ScopeVersion || null,
    }));
  }

  async countMarkedClaudeCodeLogsByTrace({
    tenantId,
    traceId,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<number> {
    EventUtils.validateTenantId(
      { tenantId },
      "CanonicalLogRecordClickHouseRepository.countMarkedClaudeCodeLogsByTrace",
    );
    const client = await this.resolveClient(tenantId);
    const { from, to } = this.window(occurredAtMs);
    const result = await client.query({
      query: `
        SELECT uniqExact(RecordId) AS c
        FROM log_records
        WHERE TenantId = {tenantId:String}
          AND CorrelationTraceId = {traceId:String}
          AND TimeUnixMs >= {from:DateTime64(3)}
          AND TimeUnixMs <= {to:DateTime64(3)}
          AND ProviderKind = 'claude_code'
          AND ProviderEventKind != ''
      `,
      query_params: { tenantId, traceId, from, to },
      format: "JSONEachRow",
    });
    const rows = await result.json<Array<{ c: number | string }>[number]>();
    return Number(rows[0]?.c ?? 0);
  }
}
