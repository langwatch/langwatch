import {
  type ColumnDef,
  ch,
  defineTable,
  replacing,
} from "@langwatch/clickhouse";
import { z } from "zod";

/**
 * `@langwatch/clickhouse`'s `ch.uint64()`/`ch.int64()` decode a *quoted
 * string* wire cell (ClickHouse sends 64-bit integers as strings so they
 * survive past `2^53`), but `Total UInt32` and `_retention_days UInt16` are
 * both sub-64-bit and arrive as bare JSON numbers — the same wire shape as
 * `Float64`. Reaching for `ch.uint64()` here would not mislabel the DDL type,
 * it would actively break decoding. Same gap `log-processing/table.ts` and
 * `simulation-processing/table.ts` already name and work around locally.
 */
function smallUint(chType: "UInt16" | "UInt32"): ColumnDef<number> {
  const schema = z.number().int().nonnegative();
  return {
    chType,
    schema,
    decode: (cell) => schema.parse(cell),
    encode: (value) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  };
}

/**
 * The `experiment_runs` ClickHouse table (ADR-099).
 *
 * Column names and types are taken from the deployed DDL —
 * `clickhouse/migrations/00002_create_schema.sql` (section 5) plus every
 * later `ALTER`: `00012` (`AvgScoreBps` widened to `Nullable(Int32)`),
 * `00015` (`LastEventOccurredAt`), `00032` (`_retention_days`,
 * `_size_bytes`), `00064` (`AppliedEventIds`). This declares the columns this
 * pipeline's rewritten fold actually reads or writes — the eleven counter
 * columns ADR-103 decision 1 retires (`Progress`, `CompletedCount`,
 * `FailedCount`, `TotalCost`, `TotalDurationMs`, `AvgScoreBps`,
 * `PassRateBps`, `TotalScoreSum`, `ScoreCount`, `PassedCount`,
 * `GradedCount`), plus `LastProcessedEventId` (dead: the old store set it to
 * the same value as `ProjectionId` and nothing read it back) and
 * `AppliedEventIds` (the mechanism ADR-098 decision 5 abolishes) are
 * deliberately absent, the same way `simulation-processing/table.ts` omits
 * `TraceMetricsJson` and `_size_bytes`. Not writing them leaves them at
 * ClickHouse's own column defaults on new rows — see this task's final report
 * for why that is a coordination requirement on the read side, not a defect
 * in this declaration.
 *
 * ## Migration required before this store can run against production
 *
 * `DeliverySeq` does not exist on the deployed table, for the same reason
 * `simulation-processing/table.ts` names: ADR-098 decision 5's redelivery
 * guard is new infrastructure its own "Migration order" section places at
 * step 5. Declaring it here states the target shape a follow-up migration
 * must add (`ALTER TABLE experiment_runs ADD COLUMN DeliverySeq UInt64
 * DEFAULT 0`) — out of scope for this pipeline-directory rewrite. Unlike
 * `simulation_runs`, though, this fold's redelivery story does not depend on
 * that column landing to be *correct* — see `store.ts`'s module docblock for
 * why every field left in `ExperimentRunState` is idempotent under
 * redelivery regardless of what `DeliverySeq` reads back as.
 *
 * `Version` is reused as the state-version column, exactly as the old
 * repository already wrote `Version: projectionVersion` for this purpose —
 * no migration needed for it.
 *
 * `StartedAt` is the table's real, deployed partition column (`PARTITION BY
 * toYearWeek(StartedAt)`). It genuinely is first-write-wins in this fold
 * (`aggregate.ts`'s `started` handler: `state.startedAt ?? data.occurredAt`),
 * so — unlike `simulation_runs`'s `StartedAt`, which the sibling file
 * documents as *not* actually frozen — `ch.acceptedAt()` here is not merely a
 * role mapping onto an imperfect column; it is upheld by this fold's own
 * handler. It is still not platform-set in the strictest ADR-099 sense
 * (`data.occurredAt` traces back to a command-envelope field a caller
 * supplies, not this pipeline's own ingest boundary — see `store.ts`'s
 * docblock on `CreatedAt` for the column that *is* strictly platform-set).
 * Declared this way because it is the table's real, immutable partition
 * column and there is no honest alternative to point `defineTable` at.
 */
export const experimentRunsTable = defineTable({
  name: "experiment_runs",
  // UpdatedAt is stamped by the projection on every write (see `store.ts`),
  // which is exactly the `writtenAt` role the ReplacingMergeTree version
  // needs (ADR-099).
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "RunId", "ExperimentId"],
  partition: { by: "toYearWeek(StartedAt)", column: "StartedAt" },
  tenant: ["TenantId"],
  columns: {
    ProjectionId: ch.string(),
    TenantId: ch.string(),
    RunId: ch.string(),
    ExperimentId: ch.string(),
    WorkflowVersionId: ch.nullable(ch.string()),
    /** The fold's state-version gate (ADR-098 decision 6), not the engine's merge version. */
    Version: ch.string(),
    Total: smallUint("UInt32"),
    Targets: ch.string(),
    StartedAt: ch.acceptedAt(),
    FinishedAt: ch.nullable(ch.dateTime64(3)),
    StoppedAt: ch.nullable(ch.dateTime64(3)),
    CreatedAt: ch.dateTime64(3),
    UpdatedAt: ch.writtenAt(),
    /** See the module docblock — requires a follow-up migration. */
    DeliverySeq: ch.uint64(),
    _retention_days: smallUint("UInt16"),
  },
});

export type ExperimentRunsRow = ReturnType<
  typeof experimentRunsTable.rowSchema.parse
>;
