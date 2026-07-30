import {
  type ColumnDef,
  ch,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";
import { z } from "zod";

/**
 * `UInt16`/`UInt32` arrive as bare JSON numbers, not the quoted strings
 * `ch.uint64()` decodes, so the narrow integer columns need their own builder.
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
 * The run row (ADR-099): the run's own facts, one row per run, nothing that
 * grows. The deployed table's `Messages.*` arrays, `LastSnapshotOccurredAt`,
 * `TraceMetricsJson` and `_size_bytes` are real columns this fold no longer
 * writes, so none is declared — each keeps its DDL default on new rows.
 *
 * `StartedAt` is the deployed partition column and is the earliest time the
 * run was observed running, so `ch.acceptedAt()` is a role mapping onto
 * today's column rather than a claim it was always frozen.
 */
export const simulationRunsTable = defineTable({
  name: "simulation_runs",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "ScenarioRunId"],
  partition: { by: "toYearWeek(StartedAt)", column: "StartedAt" },
  tenant: ["TenantId"],
  columns: {
    ProjectionId: ch.string(),
    TenantId: ch.string(),
    ScenarioRunId: ch.string(),
    ScenarioId: ch.string(),
    BatchRunId: ch.string(),
    ScenarioSetId: ch.string(),
    /** The fold's state-version gate, not the engine's merge version. */
    Version: ch.string(),
    Status: ch.string(),
    Name: ch.nullable(ch.string()),
    Description: ch.nullable(ch.string()),
    Metadata: ch.nullable(ch.string()),
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
    LastEventOccurredAt: ch.dateTime64(3),
    BatchTotal: smallUint("UInt32"),
    _retention_days: smallUint("UInt16"),
  },
});

export type SimulationRunsRow = TableRow<typeof simulationRunsTable.columns>;

/**
 * The item table a run's messages live in, one row per message. The sort key
 * is the logical message, so a redelivered message collapses to a single row
 * at merge instead of accumulating (ADR-103 decision 2).
 *
 * NOT YET DEPLOYED — see this pipeline's report for the migration it needs.
 */
export const simulationRunMessagesTable = defineTable({
  name: "simulation_run_messages",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "ScenarioRunId", "MessageId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  columns: {
    TenantId: ch.string(),
    ScenarioRunId: ch.string(),
    MessageId: ch.string(),
    /** The message's position in the conversation, as its producer numbered it. */
    MessageIndex: smallUint("UInt32"),
    Role: ch.string(),
    Content: ch.string(),
    TraceId: ch.string(),
    /** JSON of any remaining AG-UI message fields, or `""`. */
    Rest: ch.string(),
    AcceptedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
    _retention_days: smallUint("UInt16"),
  },
});

export type SimulationRunMessagesRow = TableRow<
  typeof simulationRunMessagesTable.columns
>;
