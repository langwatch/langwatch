import {
  type ClickHouseClient,
  createAppendStore,
} from "@langwatch/clickhouse";
import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import type { CanonicalLogRecord } from "./schema";
import { logRecordsTable, logUsageEstimatesTable } from "./table";

/**
 * The store `canonicalLogStorage` writes through — one bulk append that lands
 * in both `log_records` (canonical, authoritative) and `log_usage_estimates`
 * (billing), matching the old pipeline's README: "The store writes
 * `log_records`… and `log_usage_estimates`… in the same bulk append."
 *
 * ClickHouse has no cross-table transaction, so "same bulk append" means two
 * inserts issued together rather than one atomic operation — each is
 * individually durable-first via `client.insert`'s
 * `wait_for_async_insert: 1` (ADR-099 §"Writes batch client-side"), and each
 * is independently idempotent under redelivery because both tables key on
 * the record's own content hash (`table.ts`). A partial failure (one table's
 * insert lands, the other's does not) is possible and is not swallowed — see
 * `createCanonicalLogStore` below.
 */

/** Platform default, mirroring the deployed migration's `_retention_days` column default. */
const DEFAULT_RETENTION_DAYS = 308;

function toLogRecordRow(record: CanonicalLogRecord, context: BatchContext) {
  const writtenAt = new Date();
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
    TimeUnixNano: BigInt(record.timeUnixNano),
    ObservedTimeUnixNano: BigInt(record.observedTimeUnixNano),
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
    WrittenAt: writtenAt,
    DedupVersion: BigInt(writtenAt.getTime()),
    _retention_days: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
    _size_bytes: record.canonicalSizeBytes,
  };
}

function acceptedHour(acceptedAt: Date): Date {
  const hour = new Date(acceptedAt);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}

function toLogUsageEstimateRow(record: CanonicalLogRecord) {
  const writtenAt = new Date();
  const acceptedAt = new Date(record.acceptedAt);
  return {
    OrganizationId: record.organizationId,
    TenantId: record.tenantId,
    RecordId: record.recordId,
    ProviderKind: record.providerKind,
    AcceptedAt: acceptedAt,
    AcceptedHour: acceptedHour(acceptedAt),
    CanonicalSourceBytes: record.canonicalSizeBytes,
    WrittenAt: writtenAt,
    DedupVersion: BigInt(writtenAt.getTime()),
  };
}

/**
 * Builds the `AppendStore<CanonicalLogRecord>` the `canonicalLogStorage` map
 * projection writes through.
 *
 * Both underlying inserts are issued concurrently rather than one waiting on
 * the other — neither is a precondition of the other, they write disjoint
 * tables, and sequencing them would only add latency to the hot ingestion
 * path for no correctness benefit. If one insert fails, `Promise.all`
 * rejects and the caller retries the whole batch: both tables are
 * independently idempotent on redelivery (content-addressed rows), so
 * retrying a batch that partially landed re-sends rows that already exist —
 * which each table's `ReplacingMergeTree` collapses to the same row it
 * already had, not a duplicate.
 */
export function createCanonicalLogStore(args: {
  readonly client: ClickHouseClient;
}): AppendStore<CanonicalLogRecord> {
  const logRecords = createAppendStore<
    CanonicalLogRecord,
    typeof logRecordsTable.columns
  >({
    client: args.client,
    table: logRecordsTable,
    toRow: toLogRecordRow,
  });
  const logUsageEstimates = createAppendStore<
    CanonicalLogRecord,
    typeof logUsageEstimatesTable.columns
  >({
    client: args.client,
    table: logUsageEstimatesTable,
    toRow: toLogUsageEstimateRow,
  });

  return {
    kind: "append",
    async writeBatch(records, context) {
      await Promise.all([
        logRecords.writeBatch(records, context),
        logUsageEstimates.writeBatch(records, context),
      ]);
    },
  };
}
