import {
  ch,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";

/**
 * The run row (ADR-099). The eleven counter columns ADR-103 decision 1 retires
 * are deliberately absent, as are `LastProcessedEventId` and
 * `AppliedEventIds`; each keeps its DDL default on new rows.
 *
 * `StartedAt` is the deployed partition column, and the aggregate freezes it on
 * the first `started` it observes — which is what `ch.acceptedAt()` claims.
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
    Total: ch.uint32(),
    Targets: ch.string(),
    StartedAt: ch.acceptedAt(),
    FinishedAt: ch.nullable(ch.dateTime64(3)),
    StoppedAt: ch.nullable(ch.dateTime64(3)),
    CreatedAt: ch.dateTime64(3),
    UpdatedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
  },
});

export type ExperimentRunsRow = TableRow<typeof experimentRunsTable.columns>;

/**
 * The item table every total is derived from (ADR-103 decision 1). The sort key
 * ends on `ProjectionId`, a deterministic hash of the item's business key, so a
 * redelivered result collapses to one row at merge — which is what makes
 * `count()` a count of items rather than of deliveries.
 *
 * The deployed key omits `ExperimentId` (ADR-103 decision 2). Two experiments
 * sharing a `runId` therefore mint identical sort keys, and a background merge
 * deletes the older experiment's item — data loss, not a wrong number.
 */
export const experimentRunItemsTable = defineTable({
  name: "experiment_run_items",
  merge: { kind: "append" },
  sortKey: ["TenantId", "RunId", "ProjectionId"],
  partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
  tenant: ["TenantId"],
  structuralDebt: [
    {
      column: "OccurredAt",
      reason:
        "migration 00002 makes OccurredAt both the partition key and the ReplacingMergeTree version of experiment_run_items — one moving column doing two jobs ADR-099 requires a frozen, platform-set column for. The same re-key must add ExperimentId to the sort key, which the deployed key omits, so two experiments sharing a runId stop colliding; one new table and one copy fixes both, and neither ORDER BY nor PARTITION BY is alterable in place",
    },
  ],
  columns: {
    ProjectionId: ch.string(),
    TenantId: ch.string(),
    RunId: ch.string(),
    ExperimentId: ch.string(),
    RowIndex: ch.uint32(),
    TargetId: ch.string(),
    ResultType: ch.lowCardinality(ch.string()),
    DatasetEntry: ch.string(),
    Predicted: ch.nullable(ch.string()),
    TargetCost: ch.nullable(ch.float64()),
    TargetDurationMs: ch.nullable(ch.uint32()),
    TargetError: ch.nullable(ch.string()),
    TargetDomainError: ch.nullable(ch.string()),
    TraceId: ch.nullable(ch.string()),
    EvaluatorId: ch.nullable(ch.string()),
    EvaluatorName: ch.nullable(ch.string()),
    EvaluationStatus: ch.lowCardinality(ch.string()),
    Score: ch.nullable(ch.float64()),
    Label: ch.nullable(ch.string()),
    /** Tri-state: `null` unknown, `0` failed, `1` passed. */
    Passed: ch.nullable(ch.uint8()),
    EvaluationDetails: ch.nullable(ch.string()),
    EvaluationCost: ch.nullable(ch.float64()),
    EvaluationInputs: ch.nullable(ch.string()),
    EvaluationDurationMs: ch.nullable(ch.uint32()),
    CreatedAt: ch.dateTime64(3),
    OccurredAt: ch.occurredAt(),
    _retention_days: ch.uint16(),
  },
});

export type ExperimentRunItemsRow = TableRow<
  typeof experimentRunItemsTable.columns
>;
