import {
  ch,
  defineTable,
  deriveRowMapping,
  replacing,
} from "@langwatch/clickhouse";
import { type EvaluationState, evaluationStateSchema } from "./schema";

/**
 * `evaluation_analytics` as deployed (migrations 00041 and 00056): `OccurredAt`
 * partitions, expires and leads the sort key. The fold keeps it monotone and
 * never re-stamps it from a clock, which is why the row converges, but it is
 * still the evaluated work's own time rather than a platform stamp — and while
 * it leads the sort key the fold's point lookup on `(TenantId, EvaluationId)`
 * is not this key's prefix, so the replace store refuses the mount.
 */

const lowCardinalityString = () => ch.lowCardinality(ch.string());

export const evaluationAnalyticsTable = defineTable({
  name: "evaluation_analytics",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "OccurredAt", "EvaluationId"],
  partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "OccurredAt" },
  structuralDebt: [
    {
      column: "OccurredAt",
      reason:
        "migration 00041 partitions, expires and time-leads evaluation_analytics on OccurredAt, the evaluated work's own time rather than the platform-set acceptedAt role — the table never received the storage-anchor split trace_analytics got in 00061, and neither ORDER BY nor PARTITION BY is alterable in place",
    },
  ],
  columns: {
    TenantId: ch.string(),
    EvaluationId: ch.string(),
    Version: lowCardinalityString(),
    OccurredAt: ch.occurredAt(),
    CreatedAt: ch.dateTime64(3),
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
    _retention_days: ch.uint16(),
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
    // Bookkeeping, not a structural role — carried from the anchor rather than
    // a wall clock, which would move it on every write.
    CreatedAt: (state) => new Date(state.occurredAt),
    StartedAt: (state) => BigInt(state.occurredAt),
    DurationMs: (state) =>
      BigInt(
        state.completedAt > 0 && state.occurredAt > 0
          ? Math.max(0, state.completedAt - state.occurredAt)
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
