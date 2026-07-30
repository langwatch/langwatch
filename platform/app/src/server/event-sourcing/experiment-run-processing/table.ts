import {
  type ColumnDef,
  ch,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";
import { z } from "zod";

/**
 * `UInt8`/`UInt16`/`UInt32` arrive as bare JSON numbers, not the quoted
 * strings `ch.uint64()` decodes, so the narrow integer columns need their own
 * builder.
 */
function smallUint(chType: "UInt8" | "UInt16" | "UInt32"): ColumnDef<number> {
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
 * The run row (ADR-099). The eleven counter columns ADR-103 decision 1 retires
 * are deliberately absent, as are `LastProcessedEventId` and
 * `AppliedEventIds`; each keeps its DDL default on new rows.
 *
 * `StartedAt` is the deployed partition column and is first-write-wins in this
 * fold, so `ch.acceptedAt()` is upheld by the aggregate's own handler.
 */
export const experimentRunsTable = defineTable({
  name: "experiment_runs",
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
    /** The fold's state-version gate, not the engine's merge version. */
    Version: ch.string(),
    Total: smallUint("UInt32"),
    Targets: ch.string(),
    StartedAt: ch.acceptedAt(),
    FinishedAt: ch.nullable(ch.dateTime64(3)),
    StoppedAt: ch.nullable(ch.dateTime64(3)),
    CreatedAt: ch.dateTime64(3),
    UpdatedAt: ch.writtenAt(),
    _retention_days: smallUint("UInt16"),
  },
});

export type ExperimentRunsRow = TableRow<typeof experimentRunsTable.columns>;

/**
 * The item table every total is derived from (ADR-103 decision 1). The sort
 * key ends on `ProjectionId`, a deterministic hash of the item's business key,
 * so a redelivered result collapses to one row at merge instead of counting
 * twice — which is what makes `count()` a count of items, not deliveries.
 *
 * `OccurredAt` is both the deployed engine's version column and its partition
 * key, which ADR-099 lists as this table's known debt; the exit is a re-key
 * migration. It is stamped by our own orchestrator at dispatch, not by a
 * customer SDK, which is why `ch.acceptedAt()` is honest here. `append()`
 * declares the shape ADR-099 names — a `ReplacingMergeTree` whose sort key
 * already carries a per-record identity.
 */
export const experimentRunItemsTable = defineTable({
  name: "experiment_run_items",
  merge: { kind: "append" },
  sortKey: ["TenantId", "RunId", "ProjectionId"],
  partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
  tenant: ["TenantId"],
  columns: {
    ProjectionId: ch.string(),
    TenantId: ch.string(),
    RunId: ch.string(),
    ExperimentId: ch.string(),
    RowIndex: smallUint("UInt32"),
    TargetId: ch.string(),
    ResultType: ch.lowCardinality(ch.string()),
    DatasetEntry: ch.string(),
    Predicted: ch.nullable(ch.string()),
    TargetCost: ch.nullable(ch.float64()),
    TargetDurationMs: ch.nullable(smallUint("UInt32")),
    TargetError: ch.nullable(ch.string()),
    TargetDomainError: ch.nullable(ch.string()),
    TraceId: ch.nullable(ch.string()),
    EvaluatorId: ch.nullable(ch.string()),
    EvaluatorName: ch.nullable(ch.string()),
    EvaluationStatus: ch.lowCardinality(ch.string()),
    Score: ch.nullable(ch.float64()),
    Label: ch.nullable(ch.string()),
    /** Tri-state: `null` unknown, `0` failed, `1` passed. */
    Passed: ch.nullable(smallUint("UInt8")),
    EvaluationDetails: ch.nullable(ch.string()),
    EvaluationCost: ch.nullable(ch.float64()),
    EvaluationInputs: ch.nullable(ch.string()),
    EvaluationDurationMs: ch.nullable(smallUint("UInt32")),
    CreatedAt: ch.dateTime64(3),
    OccurredAt: ch.acceptedAt(),
    _retention_days: smallUint("UInt16"),
  },
});

export type ExperimentRunItemsRow = TableRow<
  typeof experimentRunItemsTable.columns
>;
