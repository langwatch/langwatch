import {
  type ColumnDef,
  ch,
  defineTable,
  deriveRowMapping,
  replacing,
} from "@langwatch/clickhouse";
import { type EvaluationState, evaluationStateSchema } from "./aggregate";

/**
 * `evaluation_analytics` (migrations 00041 and 00056), declared in the shape a
 * fold store can use rather than the shape deployed today.
 *
 * The deployed DDL partitions, expires and sorts on `OccurredAt` — a column the
 * producer sets and the fold re-stamps on every apply. A moving column may
 * anchor none of those (ADR-099), and a time-leading sort key turns the fold's
 * point lookup into a scan, so both roles move onto `CreatedAt` and the sort
 * key leads with `(TenantId, EvaluationId)`. One re-key migration makes the
 * deployed table match. `AppliedEventIds` stays undeclared — unread, unwritten.
 */

/** `@langwatch/clickhouse` has no fixed-width small-integer builder, and
 * `_retention_days` is a bare-JSON-number `UInt16`. */
function smallUint(bits: 16): ColumnDef<number> {
  const chType = `UInt${bits}`;
  const max = 2 ** bits - 1;
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

export const evaluationAnalyticsTable = defineTable({
  name: "evaluation_analytics",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "EvaluationId", "OccurredAt"],
  partition: { by: "toYearWeek(CreatedAt)", column: "CreatedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "CreatedAt" },
  columns: {
    TenantId: ch.string(),
    EvaluationId: ch.string(),
    Version: lowCardinalityString(),
    /** Business/display only — never a structural role. */
    OccurredAt: ch.occurredAt(),
    CreatedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
    EvaluatorType: lowCardinalityString(),
    EvaluatorName: ch.nullable(ch.string()),
    Status: lowCardinalityString(),
    IsGuardrail: ch.boolean(),
    Passed: ch.nullable(ch.boolean()),
    Score: ch.nullable(ch.float64()),
    Label: ch.nullable(ch.string()),
    Model: ch.nullable(ch.string()),
    TraceId: ch.nullable(ch.string()),
    UserId: ch.nullable(ch.string()),
    ConversationId: ch.nullable(ch.string()),
    CustomerId: ch.nullable(ch.string()),
    Origin: ch.nullable(ch.string()),
    DurationMs: ch.int64(),
    TotalCost: ch.nullable(ch.float64()),
    NonBilledCost: ch.nullable(ch.float64()),
    Attributes: ch.map(ch.string(), ch.string()),
    /** Epoch ms; `0` means "not yet" (migration 00056's convention). */
    StartedAt: ch.uint64(),
    CompletedAt: ch.uint64(),
    _retention_days: smallUint(16),
  },
});

export type EvaluationAnalyticsColumns =
  typeof evaluationAnalyticsTable.columns;

/** Columns the slim fold has no source for: whatever fills them is hoisted
 * from a trace's own fold, which belongs to another pipeline. */
const unpopulated = () => null;

/** Every other column is the state field of the same name, case-shifted. */
export const evaluationAnalyticsRow = deriveRowMapping<
  EvaluationState,
  EvaluationAnalyticsColumns
>({
  table: evaluationAnalyticsTable,
  state: evaluationStateSchema,
  key: "EvaluationId",
  tenant: "TenantId",
  stateVersionColumn: "Version",
  fill: {
    OccurredAt: (state) =>
      new Date(state.completedAt || state.startedAt || Date.now()),
    // Stamped by us on every write, matching the deployed column's own
    // `DEFAULT now64(3)`. It is only genuinely frozen once the re-key
    // migration gives this table a real accepted-at column.
    CreatedAt: () => new Date(),
    DurationMs: (state) =>
      BigInt(
        state.completedAt > 0 && state.startedAt > 0
          ? Math.max(0, state.completedAt - state.startedAt)
          : 0,
      ),
    Model: unpopulated,
    UserId: unpopulated,
    ConversationId: unpopulated,
    CustomerId: unpopulated,
    Origin: unpopulated,
    TotalCost: unpopulated,
    NonBilledCost: unpopulated,
  },
});
