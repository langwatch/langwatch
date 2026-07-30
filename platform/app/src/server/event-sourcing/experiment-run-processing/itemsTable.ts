import type { AnyWireColumn } from "@langwatch/clickhouse";
import { type ColumnDef, ch } from "@langwatch/clickhouse";
import { z } from "zod";

/**
 * The `experiment_run_items` ClickHouse table's wire shape (ADR-099) —
 * deliberately **not** a `defineTable` declaration. See "Why this bypasses
 * `defineTable`" below; `itemsStore.ts` is the only consumer.
 *
 * Columns and types are taken from the deployed DDL:
 * `clickhouse/migrations/00002_create_schema.sql` (section 6) plus
 * `00032_add_retention_and_size_columns.sql` (`_retention_days`) and
 * `00060_add_experiment_run_item_domain_error.sql` (`TargetDomainError`).
 * `_size_bytes` is omitted — `MATERIALIZED`, server-computed, not insertable.
 *
 * ## Why this bypasses `defineTable`
 *
 * `defineTable` (ADR-099) requires a `replacing` table's version column to
 * carry the `writtenAt` role, and unconditionally requires the partition
 * column to be `frozen && platformControlled` (the `acceptedAt` role). This
 * table's real, deployed engine is `ReplacingMergeTree(OccurredAt)` /
 * `PARTITION BY toYearWeek(OccurredAt)` — **one column plays both structural
 * roles**, which ADR-099's "Known debt this does not fix yet" section names
 * for this exact table: "`experiment_run_items` elects `OccurredAt` as both
 * its version column and its partition key... a single moving column doing
 * both jobs at once, each prohibited by the role table above."
 *
 * `OccurredAt` is also genuinely `occurredAt`-shaped, not `acceptedAt`- or
 * `writtenAt`-shaped: it is written from the event's own `data.occurredAt`
 * (`itemsMapping.ts`), which traces back to a command-envelope field the
 * caller supplies (`Date.now()` at the orchestrator's dispatch call today,
 * per `experiments-v3/execution/orchestrator.ts` — but nothing in this
 * pipeline's declared contract obliges a future caller to keep it that way).
 * No single `ch.*` role tag can honestly satisfy both `defineTable` checks at
 * once for one physical column — `ch.acceptedAt()` would pass the partition
 * check and fail the version-column check (wrong `timeRole`); `ch.writtenAt()`
 * would pass the version check and fail the partition check (`frozen: false`).
 * Fabricating a column definition with both flags set — a real option, since
 * `ColumnDef` is a plain exported interface — would not be a role mapping
 * onto an imperfect column (the honest move `simulation-processing/table.ts`
 * and `log-processing/table.ts` each make for their own imperfect anchors);
 * it would be asserting two mutually exclusive facts about one column at
 * once, which is exactly the kind of self-contradiction `defineTable` exists
 * to make unrepresentable. So this table stays outside `defineTable` rather
 * than lying to it.
 *
 * **This task's driving instructions are explicit that the fix — a re-key
 * migration giving the table its own `AcceptedAt` column, per ADR-099's own
 * prescribed exit — is out of scope here ("do not re-key it — record it as
 * debt in your report").** `itemsStore.ts` writes `OccurredAt` exactly as the
 * old pipeline did, preserving the existing (debt-carrying) engine behaviour
 * rather than attempting to route around it from application code, which
 * would not actually change what ClickHouse partitions and dedups on.
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

/** No time role at all — see the module docblock for why neither `acceptedAt` nor `writtenAt` is honest here. */
const plainDateTime64 = () => ch.dateTime64(3);

export const EXPERIMENT_RUN_ITEMS_TABLE_NAME = "experiment_run_items";

/**
 * Declaration order is the wire contract for the positional codec
 * (ADR-099) — this list, `itemsStore.ts`'s `toRow`, and the physical
 * `INSERT`'s column list must all agree.
 */
export const experimentRunItemsColumns = {
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
  Passed: ch.nullable(smallUint("UInt8")),
  EvaluationDetails: ch.nullable(ch.string()),
  EvaluationCost: ch.nullable(ch.float64()),
  EvaluationInputs: ch.nullable(ch.string()),
  EvaluationDurationMs: ch.nullable(smallUint("UInt32")),
  CreatedAt: plainDateTime64(),
  // The table's real ReplacingMergeTree version AND partition column — see
  // the module docblock. Deliberately untagged (no `timeRole`): this pipeline
  // never passes it to anything that inspects the tag, and tagging it either
  // way would be an unsupportable claim about a column that structurally
  // cannot satisfy either role's requirements alone.
  OccurredAt: plainDateTime64(),
  _retention_days: smallUint("UInt16"),
} as const;

export type ExperimentRunItemsColumnName =
  keyof typeof experimentRunItemsColumns;

export const experimentRunItemsColumnNames = Object.keys(
  experimentRunItemsColumns,
) as readonly ExperimentRunItemsColumnName[];

export const experimentRunItemsWireColumns: readonly AnyWireColumn[] =
  experimentRunItemsColumnNames.map((name) => experimentRunItemsColumns[name]);

/** The row shape on the wire, in declaration order — mirrors `defineTable`'s `TableRow<Columns>`. */
export type ExperimentRunItemsRow = {
  [K in ExperimentRunItemsColumnName]: (typeof experimentRunItemsColumns)[K] extends ColumnDef<
    infer T
  >
    ? T
    : never;
};
