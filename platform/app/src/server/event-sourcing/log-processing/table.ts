import { append, type ColumnDef, ch, defineTable } from "@langwatch/clickhouse";

/**
 * The two ClickHouse tables `canonicalLogStorage` writes into
 * (`src/server/clickhouse/migrations/00050_create_canonical_logs.sql`,
 * deployed — immutable). Both are declared with `merge: append()`: their
 * `ReplacingMergeTree` sort key already carries the record's own content
 * hash (`RecordId`), which is exactly the "per-record identity" `append()`
 * documents as the other legal shape for a `ReplacingMergeTree` table
 * (ADR-099 §"Every row carries an idempotency key…"), so a redelivered
 * record collapses to one row without this declaration needing a formal
 * `replacing({ version })`.
 *
 * === Two gaps this declaration ran into, flagged rather than papered over ===
 *
 * **1. No fixed-width small-integer column builder.** `@langwatch/clickhouse`'s
 * `ch.*` set has `uint64`/`int64` (decoding to `bigint`, because the wire
 * sends a quoted string) and `float64` (decoding a bare JSON number), but
 * nothing for `UInt8`/`UInt16`/`UInt32` — which ClickHouse's JSON formats send
 * as a *bare* JSON number, same as `Float64`, not a quoted string. `log_records`
 * alone has five such columns (`SeverityNumber UInt8`,
 * `ResourceDroppedAttributesCount`/`ScopeDroppedAttributesCount`/
 * `DroppedAttributesCount`/`Flags UInt32`, `_retention_days UInt16`,
 * `_size_bytes UInt32`). Reaching for `ch.uint64()` here would not just
 * mislabel the DDL type — it would actively break decoding, because its
 * schema is `z.string().transform(...)` and a real UInt32 cell is a plain
 * number, never a string. `smallUint` below is a minimal, honest
 * `ColumnDef<number>` built from the same public shape the package's own
 * builders return (`ColumnDef` is an exported type for exactly this reason).
 * This looks like a real, worth-filling gap in the shared package, not
 * something specific to this table.
 *
 * **2. `log_records`'s deployed partition/TTL anchor is `TimeUnixMs`, which
 * is occurredAt-shaped, not acceptedAt-shaped.** `TimeUnixMs` is derived from
 * the *customer-supplied* `timeUnixNano`/`observedTimeUnixNano` (see
 * `canonicalize.ts`), so `defineTable` correctly refuses it as a partition
 * column or TTL anchor (ADR-099: only a frozen, platform-set column may carry
 * that structure). The table below anchors on `AcceptedAt` instead — the
 * ADR-099-*compliant* shape — which is a deliberate deviation from the
 * literal deployed DDL (`PARTITION BY toYearWeek(TimeUnixMs)`), not a
 * transcription of it. `AcceptedAt` is a real column on the deployed table
 * (just not the one it currently partitions on), so this declaration does
 * not invent a column that is not there.
 *
 * ADR-099's own "Known debt this does not fix yet" section lists this exact
 * defect class for eight other tables (`event_log`, `trace_summaries`,
 * `evaluation_analytics`, …) but does not mention `log_records`, which has
 * the identical shape: a customer-controlled column used to partition and
 * expire the table, making part count, partition spread and retention a
 * customer-controlled input. That omission looks like an oversight rather
 * than a deliberate exclusion, and it is flagged here rather than silently
 * matched — fixing it for real needs a re-key migration (create new, backfill,
 * `EXCHANGE TABLES`, per ADR-099's own recipe for the tables it does list),
 * which is out of scope for a pipeline-level rewrite and touches
 * `src/server/clickhouse/migrations/`, outside this pipeline's directory.
 * `sortKey` below is left as deployed (`TimeUnixMs` still orders rows) —
 * `defineTable` does not require a sort-key time column to be frozen, only
 * the partition column and the TTL anchor, so this is the one place the
 * declaration can stay literally accurate without tripping the guard.
 */
function smallUint(bits: 8 | 16 | 32): ColumnDef<number> {
  const chType = `UInt${bits}`;
  const max = 2 ** bits - 1;
  // `ch.float64()`'s schema already accepts a bare JSON number, which is
  // exactly how ClickHouse's JSON formats send a sub-64-bit integer — the
  // same wire shape as Float64, unlike UInt64/Int64's quoted-string form.
  // `.refine` narrows it to this width's integer range, so an out-of-range
  // or fractional cell is rejected rather than silently coerced.
  const schema = ch.float64().schema.refine(
    (value) => Number.isInteger(value) && value >= 0 && value <= max,
    (value) => ({
      message: `"${String(value)}" is not a valid ${chType} wire value`,
    }),
  );
  return {
    chType,
    schema,
    decode: (cell: unknown) => schema.parse(cell),
    encode: (value: number) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  };
}

const lowCardinalityString = () => ch.lowCardinality(ch.string());

export const logRecordsTable = defineTable({
  name: "log_records",
  merge: append(),
  sortKey: ["TenantId", "CorrelationTraceId", "TimeUnixMs", "RecordId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    RecordId: ch.string(),
    ResourceSchemaUrl: ch.string(),
    ResourceAttributesJson: ch.string(),
    ResourceAttributesFlatJson: ch.string(),
    ResourceAttributeKeys: ch.array(ch.string()),
    ResourceDroppedAttributesCount: smallUint(32),
    ScopeSchemaUrl: ch.string(),
    ScopeName: ch.string(),
    ScopeVersion: ch.string(),
    ScopeAttributesJson: ch.string(),
    ScopeAttributeKeys: ch.array(ch.string()),
    ScopeDroppedAttributesCount: smallUint(32),
    WireTraceId: ch.string(),
    WireSpanId: ch.string(),
    CorrelationTraceId: ch.string(),
    CorrelationSpanId: ch.string(),
    CorrelationSource: lowCardinalityString(),
    TimeUnixNano: ch.uint64(),
    ObservedTimeUnixNano: ch.uint64(),
    TimeUnixMs: ch.occurredAt(),
    SeverityNumber: smallUint(8),
    SeverityText: lowCardinalityString(),
    BodyType: lowCardinalityString(),
    BodyJson: ch.string(),
    BodyText: ch.nullable(ch.string()),
    AttributesJson: ch.string(),
    AttributesFlatJson: ch.string(),
    AttributeKeys: ch.array(ch.string()),
    DroppedAttributesCount: smallUint(32),
    Flags: smallUint(32),
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
    DedupVersion: ch.uint64(),
    _retention_days: smallUint(16),
    _size_bytes: smallUint(32),
  },
});

export const logUsageEstimatesTable = defineTable({
  name: "log_usage_estimates",
  merge: append(),
  sortKey: ["OrganizationId", "TenantId", "RecordId"],
  partition: { by: "toYYYYMM(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    OrganizationId: ch.string(),
    TenantId: ch.string(),
    RecordId: ch.string(),
    ProviderKind: lowCardinalityString(),
    AcceptedAt: ch.acceptedAt(),
    // The deployed column is plain `DateTime` (second precision), not
    // `DateTime64`. `ch.dateTime64(0)`'s wire codec is compatible — its
    // fractional group is optional on decode and omitted on encode at
    // precision 0 — so this reads and writes the same bytes; only the
    // reported `chType` ("DateTime64(0)") does not literally match the
    // DDL's `DateTime`. Not worth a dedicated builder for one column.
    AcceptedHour: ch.dateTime64(0),
    CanonicalSourceBytes: smallUint(32),
    WrittenAt: ch.writtenAt(),
    DedupVersion: ch.uint64(),
  },
});
