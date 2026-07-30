import {
  type ColumnDef,
  ch,
  defineTable,
  replacing,
} from "@langwatch/clickhouse";
import { z } from "zod";

/**
 * The two tables `canonicalLogStorage` writes into (migration `00050`,
 * deployed — immutable). Both are `ReplacingMergeTree(DedupVersion)`, so a
 * redelivered record collapses onto its `RecordId` at merge (ADR-099).
 */

const lowCardinalityString = () => ch.lowCardinality(ch.string());

/**
 * The deployed engine version column: epoch milliseconds in a `UInt64`, stamped
 * on every write. `ch.writtenAt()` carries the same role in a `DateTime64`,
 * which is not the deployed type.
 */
const dedupVersion = (): ColumnDef<bigint> => ({
  ...ch.uint64(),
  timeRole: "writtenAt",
  platformControlled: true,
});

/**
 * `00050` stores `RecordId` as `FixedString(64)`, which pads a short value with
 * NUL bytes rather than storing it as given, so the width is part of the
 * contract and not a storage hint.
 */
function fixedString(width: number): ColumnDef<string> {
  const schema = z.string();
  return {
    chType: `FixedString(${width})`,
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  };
}

export const logRecordsTable = defineTable({
  name: "log_records",
  merge: replacing({ version: "DedupVersion" }),
  sortKey: ["TenantId", "CorrelationTraceId", "TimeUnixMs", "RecordId"],
  partition: { by: "toYearWeek(TimeUnixMs)", column: "TimeUnixMs" },
  tenant: ["TenantId"],
  ttl: { anchor: "TimeUnixMs" },
  structuralDebt: [
    {
      column: "TimeUnixMs",
      reason:
        "migration 00050 partitions and expires log_records on TimeUnixMs, the record's own timestamp as the emitting process stamped it, so a skewed or backfilling client controls partition spread and retention. TimeUnixMs is in the dedup key, so re-anchoring on AcceptedAt needs a new table and a copy rather than an ALTER",
    },
  ],
  columns: {
    TenantId: ch.string(),
    RecordId: fixedString(64),
    ResourceSchemaUrl: ch.string(),
    ResourceAttributesJson: ch.string(),
    ResourceAttributesFlatJson: ch.string(),
    ResourceAttributeKeys: ch.array(ch.string()),
    ResourceDroppedAttributesCount: ch.uint32(),
    ScopeSchemaUrl: ch.string(),
    ScopeName: ch.string(),
    ScopeVersion: ch.string(),
    ScopeAttributesJson: ch.string(),
    ScopeAttributeKeys: ch.array(ch.string()),
    ScopeDroppedAttributesCount: ch.uint32(),
    WireTraceId: ch.string(),
    WireSpanId: ch.string(),
    CorrelationTraceId: ch.string(),
    CorrelationSpanId: ch.string(),
    CorrelationSource: lowCardinalityString(),
    TimeUnixNano: ch.uint64(),
    ObservedTimeUnixNano: ch.uint64(),
    TimeUnixMs: ch.occurredAt(),
    SeverityNumber: ch.uint8(),
    SeverityText: lowCardinalityString(),
    BodyType: lowCardinalityString(),
    BodyJson: ch.string(),
    BodyText: ch.nullable(ch.string()),
    AttributesJson: ch.string(),
    AttributesFlatJson: ch.string(),
    AttributeKeys: ch.array(ch.string()),
    DroppedAttributesCount: ch.uint32(),
    Flags: ch.uint32(),
    EventName: ch.string(),
    ProviderKind: lowCardinalityString(),
    ProviderEventKind: lowCardinalityString(),
    ProviderEventSequence: ch.string(),
    ProviderSessionId: ch.string(),
    ProviderConversationId: ch.string(),
    ProviderPromptId: ch.string(),
    PiiRedactionLevel: lowCardinalityString(),
    CanonicalPayload: ch.string(),
    OccurredAt: ch.occurredAt(),
    AcceptedAt: ch.acceptedAt(),
    WrittenAt: ch.writtenAt(),
    DedupVersion: dedupVersion(),
    _retention_days: ch.uint16(),
    _size_bytes: ch.uint32(),
  },
});

export const logUsageEstimatesTable = defineTable({
  name: "log_usage_estimates",
  merge: replacing({ version: "DedupVersion" }),
  sortKey: ["OrganizationId", "TenantId", "RecordId"],
  partition: { by: "toYYYYMM(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    OrganizationId: ch.string(),
    TenantId: ch.string(),
    RecordId: fixedString(64),
    ProviderKind: lowCardinalityString(),
    AcceptedAt: ch.acceptedAt(),
    AcceptedHour: ch.dateTime(),
    CanonicalSourceBytes: ch.uint32(),
    WrittenAt: ch.writtenAt(),
    DedupVersion: dedupVersion(),
  },
});
