import {
  type ColumnDef,
  ch,
  defineTable,
  replacing,
} from "@langwatch/clickhouse";

/**
 * The deployed `evaluation_analytics` ClickHouse table (ADR-099), read verbatim
 * from `src/server/clickhouse/migrations/00041_create_evaluation_analytics.sql`
 * plus the `00056_analytics_folds_read_back.sql` `ALTER TABLE`s that added
 * `StartedAt`/`CompletedAt`/`AppliedEventIds`. Deployed migrations are
 * immutable, so this declaration describes the table that already exists —
 * with two flagged exceptions below, matching the precedent
 * `log-processing/table.ts` set for `log_records`' own `AcceptedAt`
 * role-mapping.
 *
 * === Finding #1 (task-requested check, not fixed here): the moving
 * partition column ===
 *
 * The deployed DDL partitions and expires on `OccurredAt`:
 *
 * ```sql
 * PARTITION BY toYearWeek(OccurredAt)
 * ORDER BY (TenantId, OccurredAt, EvaluationId)
 * TTL ... toDateTime(OccurredAt) + toIntervalDay(_retention_days) ...
 * ```
 *
 * and the old fold (`evaluationAnalytics.foldProjection.ts`,
 * `projectEvaluationAnalyticsStateToRow`) stamps it from the LATEST folded
 * event: `occurredAtMs: state.LastEventOccurredAt`. That is exactly the
 * `occurredAt` role ADR-099 forbids from ever anchoring a partition key, a
 * TTL, or a dedup-subquery bound — `OccurredAt` is set by the event's own
 * producer and moves forward on every fold apply, so `defineTable` refuses
 * to accept it here (`ch.occurredAt()` is structurally ineligible: `frozen:
 * false`, `platformControlled: false`). Confirmed independently against
 * `app-layer/analytics/query-builders/eval-slim-timeseries-query.ts`'s
 * `dedupedSlim()`, which bounds BOTH the outer scope and the inner dedup
 * `GROUP BY` subquery on this same moving `OccurredAt` — the live mechanism
 * ADR-099's Context section names: a row's true latest version can fall
 * outside the query's time window while an earlier, non-terminal version
 * (say, a `started` row) falls inside it, so the dedup subquery's `max(UpdatedAt)`
 * is computed over the WRONG subset and a stale, non-null, plausible row wins.
 * Concretely: an evaluation that finished shows up as still "in progress" in
 * that query for as long as its `started` version's `OccurredAt` sits inside
 * the requested window and its `reported` version's does not.
 *
 * `evaluation_analytics` never received the storage-anchor split
 * `trace_analytics` got (a separate, frozen `AcceptedAt` column) — see the
 * task report for the full account. **This is reported, not fixed**: closing
 * it for the deployed table needs a re-key migration (create new, backfill,
 * `EXCHANGE TABLES`, per ADR-099's own recipe), which touches
 * `src/server/clickhouse/migrations/` — outside this pipeline's directory,
 * and explicitly out of scope for this rewrite.
 *
 * What this declaration does instead: it role-maps the partition/TTL anchor
 * onto `CreatedAt` — a real, already-deployed column
 * (`CreatedAt DateTime64(3) DEFAULT now64(3)`) that the OLD fold's own
 * `AbstractFoldProjection.init()` stamps exactly ONCE, at genesis
 * (`Date.now()`, never touched again by `apply()` — verified against
 * `event-sourcing.old/projections/abstractFoldProjection.ts:205-213`), so it
 * is genuinely frozen for the row's life AND platform-set — the two tests
 * ADR-099 requires of an anchor column. This is the same move
 * `log-processing/table.ts` made for `log_records`' `AcceptedAt` (a real
 * column already on the table, just not the one it currently partitions on);
 * the difference here is that `evaluation_analytics` has no column literally
 * NAMED `AcceptedAt`, so the role-map lands on `CreatedAt` instead, by the
 * same eligibility test rather than by name.
 *
 * This role-map does not, by itself, repair `eval-slim-timeseries-query.ts` —
 * that file reads the DEPLOYED table under its DEPLOYED DDL and is untouched
 * by this declaration (outside this pipeline's directory besides). What it
 * does do: it makes THIS fold's own read-back — `evaluationAnalytics.store.ts`,
 * a point lookup by `(TenantId, EvaluationId)`, never a windowed dedup
 * subquery — immune to the defect by construction, independent of whichever
 * column the table happens to partition on. See that module's docblock for
 * why a point lookup was never exposed to this defect in the first place.
 *
 * === Finding #2: `DeliverySeq` does not exist on the deployed table ===
 *
 * ADR-098 decision 5's redelivery guard — a monotonic per-group sequence
 * assigned at staging — is new infrastructure `@langwatch/event-sourcing`'s
 * `createFoldExecutor` depends on (`FoldDelivery.deliverySeq`,
 * `StoredState.deliverySeq`). The deployed table has no such column; it has
 * `AppliedEventIds Array(String)`, the mechanism decision 5 retires. Declaring
 * `DeliverySeq` here — required structurally by `ReplaceStore<State>` — states
 * the target shape a small follow-up migration must add
 * (`ALTER TABLE evaluation_analytics ADD COLUMN DeliverySeq UInt64 DEFAULT 0`),
 * exactly the gap `simulation-processing/table.ts` flagged for
 * `simulation_runs`. Out of scope here ("touch only your pipeline's
 * directory"); flagged in the driving task's report rather than silently
 * assumed. `AppliedEventIds` itself is left undeclared: this rewrite's fold
 * never reads or writes it, and an undeclared real column is simply left
 * alone by every insert this store issues (ClickHouse fills it from its own
 * default).
 *
 * === What this table does NOT carry ===
 *
 * `Details`/`Error`/`ErrorDetails`/`Inputs` are deliberately absent — the
 * deployed table is the SLIM projection (the migration's own header: "Drops
 * the heavy free-text fields... entirely"). Those live on `evaluation_runs`
 * (the OLD pipeline's separate `EvaluationRunFoldProjection`/full fold),
 * which this rewrite does not convert — out of scope; see the task report.
 * `Model` is declared (a real column) but this rewrite's fold never
 * populates it, matching the old fold's own behaviour (no model tracked at
 * this event layer).
 */

/**
 * `@langwatch/clickhouse` has no fixed-width small-integer builder
 * (`ch.uint64()` decodes a quoted wire string to `bigint`; `_retention_days`
 * is a bare-JSON-number `UInt16`) — the identical gap
 * `log-processing/table.ts` and `simulation-processing/table.ts` both hit and
 * both worked around the same way: built directly against the exported
 * `ColumnDef<T>` contract rather than duplicating an existing builder.
 */
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
  // Deployed as-is: time-leading, not key-leading. A point lookup by
  // (TenantId, EvaluationId) — see `evaluationAnalytics.store.ts` — relies on
  // the deployed `idx_eval_analytics_tenant_eval` bloom-filter index for
  // pruning rather than the primary sort key's own prefix, since EvaluationId
  // is the sort key's third member rather than its second. `defineTable` only
  // requires membership, not a leading position, for a store's `keyColumn`.
  sortKey: ["TenantId", "OccurredAt", "EvaluationId"],
  // Role-mapped onto CreatedAt — see Finding #1 above.
  partition: { by: "toYearWeek(CreatedAt)", column: "CreatedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "CreatedAt" },
  columns: {
    TenantId: ch.string(),
    EvaluationId: ch.string(),
    Version: lowCardinalityString(),
    // Display/business column only, never a structural one — see Finding #1.
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
    // Epoch ms; 0 = "not yet" (migration 00056's own convention — see the
    // store's decode for the null mapping).
    StartedAt: ch.uint64(),
    CompletedAt: ch.uint64(),
    _retention_days: smallUint(16),
    /** See Finding #2 — requires a follow-up migration. */
    DeliverySeq: ch.uint64(),
  },
});

export type EvaluationAnalyticsColumns =
  typeof evaluationAnalyticsTable.columns;
