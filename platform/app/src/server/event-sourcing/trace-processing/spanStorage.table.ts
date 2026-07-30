import { append, ch, defineTable, type ColumnDef } from "@langwatch/clickhouse";

/**
 * `stored_spans` — every canonicalized span, regardless of `traceSummary`'s
 * derivation cap. The sort key leads with the content-identified `SpanId`, so
 * a redelivered span collapses to one row without a version column.
 */

function smallUint(bits: 8 | 16 | 32): ColumnDef<number> {
  const chType = `UInt${bits}`;
  const max = 2 ** bits - 1;
  const schema = ch.float64().schema.refine(
    (value) => Number.isInteger(value) && value >= 0 && value <= max,
    (value) => ({ message: `"${String(value)}" is not a valid ${chType} wire value` }),
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

export const storedSpansTable = defineTable({
  name: "stored_spans",
  merge: append(),
  sortKey: ["TenantId", "TraceId", "StartTimeUnixMs", "SpanId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    TraceId: ch.string(),
    SpanId: ch.string(),
    ParentSpanId: ch.nullable(ch.string()),
    Name: ch.string(),
    Kind: ch.lowCardinality(ch.string()),
    StartTimeUnixMs: ch.uint64(),
    EndTimeUnixMs: ch.uint64(),
    DurationMs: ch.uint64(),
    StatusCode: ch.lowCardinality(ch.string()),
    StatusMessage: ch.nullable(ch.string()),
    AttributesJson: ch.string(),
    ResourceAttributesJson: ch.string(),
    InstrumentationScopeName: ch.lowCardinality(ch.string()),
    Model: ch.nullable(ch.lowCardinality(ch.string())),
    Cost: ch.nullable(ch.float64()),
    NonBilledCost: ch.nullable(ch.float64()),
    PromptTokens: ch.nullable(ch.uint64()),
    CompletionTokens: ch.nullable(ch.uint64()),
    PiiRedactionStatus: ch.nullable(ch.lowCardinality(ch.string())),
    OccurredAt: ch.occurredAt(),
    AcceptedAt: ch.acceptedAt(),
    WrittenAt: ch.writtenAt(),
    _retention_days: smallUint(16),
  },
});
export type StoredSpansRow = ReturnType<typeof storedSpansTable.rowSchema.parse>;
