import {
  type ColumnDef,
  ch,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";
import { z } from "zod";

/**
 * `@langwatch/clickhouse`'s `ch.*` builders cover `UInt64`/`Int64` (wire
 * strings, decoded to `bigint`) and `Float64`, but not the narrower
 * `UInt16`/`UInt32` this table's real DDL uses for `_retention_days` and
 * `BatchTotal` — ClickHouse's JSON formats send both as bare JSON numbers,
 * same as any other integer under 2^53, so there is nothing a `bigint`
 * column buys here. Built directly against the exported `ColumnDef<T>`
 * contract (ADR-099's "each `ch.*` builder... carries three things") rather
 * than duplicating one of the existing builders and drifting from it.
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
 * The `simulation_runs` ClickHouse table (ADR-099).
 *
 * Column names and types below are taken verbatim from the deployed DDL —
 * `clickhouse/migrations/00002_create_schema.sql` plus every later `ALTER`
 * that touched this table (`00004`, `00006`, `00008`, `00015`, `00016`,
 * `00032`, `00062`) — so this definition describes the table that already
 * exists, not an aspirational one. Two columns are the exception; see
 * "Migration required" below.
 *
 * Two real, deployed columns are deliberately **not** declared here:
 * `TraceMetricsJson` (the retired per-trace accumulator's leftover column,
 * kept only so its `DEFAULT ''` satisfies old rows — this pipeline never
 * reads or writes it, matching the old repository's own comment) and
 * `_size_bytes` (`MATERIALIZED`, server-computed at insert time — not
 * insertable, and `@langwatch/clickhouse`'s `ColumnMap` has no materialized-
 * column concept). Neither is part of this pipeline's read or write surface.
 *
 * ## Migration required before this store can run against production
 *
 * `DeliverySeq` does not exist on the deployed table. ADR-098 decision 5's
 * redelivery guard — "a monotonic per-group sequence assigned at staging,
 * not an event-time watermark" — is new infrastructure the decision's own
 * "Migration order" section places at step 5, after the taxonomy, ordering
 * and read-outcome rules (steps 1-4) that this rewrite otherwise completes.
 * The old `simulationRunState` fold never had this column either — it kept
 * correctness through order-invariant handlers alone
 * (`refoldOnOutOfOrder: false`, see `aggregate.ts`), which is exactly what
 * this rewrite's handlers still do. Declaring `DeliverySeq` here — required
 * structurally by `@langwatch/event-sourcing`'s `ReplaceStore<State>`
 * contract, which `createFoldExecutor` depends on for its redelivery-skip
 * check — states the target shape a small follow-up migration must add
 * (`ALTER TABLE simulation_runs ADD COLUMN DeliverySeq UInt64 DEFAULT 0`).
 * That migration is out of scope here ("touch only your pipeline's
 * directory"); flagged in the driving task's report rather than silently
 * assumed.
 *
 * `Version` is reused as the state-version column rather than adding a new
 * one — the old repository already wrote `Version: projectionVersion` for
 * exactly this purpose, so no migration is needed for it.
 */
export const simulationRunsTable = defineTable({
  name: "simulation_runs",
  // UpdatedAt already exists and is exactly a `writtenAt` column: stamped by
  // the projection on every write, which is what makes it usable as the
  // ReplacingMergeTree version (ADR-099).
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "ScenarioRunId"],
  // StartedAt is the table's real, deployed partition column
  // (`PARTITION BY toYearWeek(StartedAt)`). It is not actually frozen — a
  // snapshot arriving before the `started` event seeds a provisional value
  // that `started` later overwrites (documented in
  // `app-layer/simulations/repositories/simulationRuns.sql.ts`'s
  // `startedAtBoundsForPage`) — so declaring it `ch.acceptedAt()` is a role
  // mapping onto today's column name, exactly as ADR-099 anticipates for an
  // existing table ("Existing tables declare a role mapping... so the rules
  // apply to today's column names"), not a claim that the column has always
  // behaved correctly. Inherited debt, not introduced by this rewrite.
  partition: { by: "toYearWeek(StartedAt)", column: "StartedAt" },
  tenant: ["TenantId"],
  columns: {
    ProjectionId: ch.string(),
    TenantId: ch.string(),
    ScenarioRunId: ch.string(),
    ScenarioId: ch.string(),
    BatchRunId: ch.string(),
    ScenarioSetId: ch.string(),
    /** The fold's state-version gate (ADR-098 decision 6), not the engine's merge version. */
    Version: ch.string(),
    Status: ch.string(),
    Name: ch.nullable(ch.string()),
    Description: ch.nullable(ch.string()),
    Metadata: ch.nullable(ch.string()),
    "Messages.Id": ch.array(ch.string()),
    "Messages.Role": ch.array(ch.string()),
    "Messages.Content": ch.array(ch.string()),
    "Messages.TraceId": ch.array(ch.string()),
    "Messages.Rest": ch.array(ch.string()),
    TraceIds: ch.array(ch.string()),
    Verdict: ch.nullable(ch.string()),
    Reasoning: ch.nullable(ch.string()),
    MetCriteria: ch.array(ch.string()),
    UnmetCriteria: ch.array(ch.string()),
    Error: ch.nullable(ch.string()),
    DurationMs: ch.nullable(ch.uint64()),
    TotalCost: ch.nullable(ch.float64()),
    RoleCosts: ch.map(ch.string(), ch.array(ch.float64())),
    RoleLatencies: ch.map(ch.string(), ch.array(ch.float64())),
    StartedAt: ch.acceptedAt(),
    QueuedAt: ch.nullable(ch.dateTime64(3)),
    CreatedAt: ch.dateTime64(3),
    UpdatedAt: ch.writtenAt(),
    FinishedAt: ch.nullable(ch.dateTime64(3)),
    ArchivedAt: ch.nullable(ch.dateTime64(3)),
    CancellationRequestedAt: ch.nullable(ch.dateTime64(3)),
    LastSnapshotOccurredAt: ch.dateTime64(3),
    LastEventOccurredAt: ch.dateTime64(3),
    BatchTotal: smallUint("UInt32"),
    /** See the module docblock — requires a follow-up migration. */
    DeliverySeq: ch.uint64(),
    _retention_days: smallUint("UInt16"),
  },
});

/**
 * Derived via `@langwatch/clickhouse`'s own `TableRow<Columns>` — the row
 * shape a table's columns imply — rather than hand-rolled from
 * `rowSchema.parse`'s return type, so this can never drift from what
 * `defineTable` itself considers the row to be.
 */
export type SimulationRunsRow = TableRow<typeof simulationRunsTable.columns>;
