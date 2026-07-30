import {
  type ClickHouseClient,
  createRowCodec,
  type WireCodec,
} from "@langwatch/clickhouse";
import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import {
  EXPERIMENT_RUN_ITEMS_TABLE_NAME,
  type ExperimentRunItemsRow,
  experimentRunItemsColumnNames,
  experimentRunItemsWireColumns,
} from "./itemsTable";
import type { ExperimentRunItemRecord } from "./schema";

/**
 * The `AppendStore<ExperimentRunItemRecord>` for `experiment_run_items`
 * (ADR-098 §2, ADR-099, ADR-102).
 *
 * `@langwatch/clickhouse`'s `createAppendStore` is not used: it is built on
 * top of a `defineTable` `TableDefinition`, and `itemsTable.ts`'s module
 * docblock explains why this table cannot be declared through `defineTable`
 * at all (the `OccurredAt` double-duty ADR-099 already lists as known debt).
 * This module reproduces `createAppendStore`'s own logic by hand, one level
 * down, against the plain wire-column array `itemsTable.ts` exports instead
 * of a `TableDefinition`: encode via the shared `WireCodec`, one
 * `client.insert` per batch (never one per record — ADR-099's "one insert
 * per span" incident is exactly the shape a per-record write would repeat
 * here), `target: { kind: "replacing" }` because the deployed engine is
 * `ReplacingMergeTree(OccurredAt)` with `ProjectionId` carrying per-record
 * identity in the sort key (ADR-104 §2 — this is why the write is retryable
 * at all).
 */

const DEFAULT_RETENTION_DAYS = 308;

function toRow(
  record: ExperimentRunItemRecord,
  retentionDays: number,
): ExperimentRunItemsRow {
  return {
    ProjectionId: record.projectionId,
    TenantId: record.tenantId,
    RunId: record.runId,
    ExperimentId: record.experimentId,
    RowIndex: record.rowIndex,
    TargetId: record.targetId,
    ResultType: record.resultType,
    DatasetEntry: record.datasetEntry,
    Predicted: record.predicted,
    TargetCost: record.targetCost,
    TargetDurationMs: record.targetDurationMs,
    TargetError: record.targetError,
    TargetDomainError: record.targetDomainError,
    TraceId: record.traceId,
    EvaluatorId: record.evaluatorId,
    EvaluatorName: record.evaluatorName,
    EvaluationStatus: record.evaluationStatus,
    Score: record.score,
    Label: record.label,
    Passed: record.passed,
    EvaluationDetails: record.evaluationDetails,
    EvaluationCost: record.evaluationCost,
    EvaluationInputs: record.evaluationInputs,
    EvaluationDurationMs: record.evaluationDurationMs,
    CreatedAt: new Date(),
    // The table's real version + partition column — see `itemsTable.ts`'s
    // module docblock. Written from the event's own `occurredAt`, exactly as
    // the old pipeline's `mapExperimentRunTargetResult`/
    // `mapExperimentRunEvaluatorResult` did (`new Date(event.occurredAt)`).
    OccurredAt: new Date(record.occurredAt),
    _retention_days: retentionDays,
  };
}

export interface ExperimentRunItemsStoreArgs {
  readonly client: ClickHouseClient;
  /** @default createRowCodec() */
  readonly codec?: WireCodec;
}

export function createExperimentRunItemsStore(
  args: ExperimentRunItemsStoreArgs,
): AppendStore<ExperimentRunItemRecord> {
  const { client } = args;
  const codec = args.codec ?? createRowCodec();

  return {
    kind: "append",

    async writeBatch(
      records: readonly ExperimentRunItemRecord[],
      context: BatchContext,
    ): Promise<void> {
      if (records.length === 0) return;

      const retentionDays = context.retentionDays ?? DEFAULT_RETENTION_DAYS;
      const rows = records.map((record) => toRow(record, retentionDays));
      const encodedRows = codec.encodeRows({
        columns: experimentRunItemsWireColumns,
        columnNames: experimentRunItemsColumnNames,
        rows,
      });

      // Durable-first by construction: `client.insert` only resolves once
      // `wait_for_async_insert` confirms the block landed (ADR-098, ADR-099,
      // ADR-104).
      await client.insert({
        tenantId: context.tenantId,
        table: EXPERIMENT_RUN_ITEMS_TABLE_NAME,
        rows: encodedRows,
        columns: experimentRunItemsColumnNames,
        target: { kind: "replacing" },
      });
    },
  };
}
