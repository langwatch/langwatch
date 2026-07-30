import { ch, defineTable, replacing, type ColumnDef } from "@langwatch/clickhouse";

/**
 * `trace_analytics_rollup` — see `traceAnalyticsRollup.ts`'s module docblock
 * for why this is `replacing({ version: "UpdatedAt" })`, not the old table's
 * `AggregatingMergeTree`.
 */

function smallUint(bits: 16 | 32): ColumnDef<number> {
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

export const traceAnalyticsRollupTable = defineTable({
  name: "trace_analytics_rollup",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "BucketStart", "Model", "SpanType"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    BucketStart: ch.dateTime64(0),
    Model: ch.lowCardinality(ch.string()),
    SpanType: ch.lowCardinality(ch.string()),
    Version: ch.string(),

    SpanCount: ch.uint64(),
    TraceCount: ch.uint64(),
    ErrorCount: ch.uint64(),
    CostSum: ch.float64(),
    NonBilledCostSum: ch.float64(),
    DurationSum: ch.uint64(),
    PromptTokensSum: ch.uint64(),
    CompletionTokensSum: ch.uint64(),
    CacheReadTokensSum: ch.uint64(),
    CacheWriteTokensSum: ch.uint64(),
    ReasoningTokensSum: ch.uint64(),

    AcceptedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
    _retention_days: smallUint(16),
  },
});
export type TraceAnalyticsRollupRow = ReturnType<typeof traceAnalyticsRollupTable.rowSchema.parse>;
