import {
  bindIdentifiers,
  type ClickHouseClient,
  ch,
  createRowCodec,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";
import { createLogger } from "@langwatch/observability";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "~/server/data-retention/retentionPolicyResolver";
import type {
  DspyExampleData,
  DspyLlmCallData,
  DspyPredictorData,
  DspyStepData,
  DspyStepSummaryData,
} from "../types";
import type { DspyStepRepository } from "./dspy-step.repository";

const logger = createLogger(
  "langwatch:app-layer:dspy-steps:dspy-step-repository",
);

/**
 * `dspy_steps` (migration 00005 + 00032). `CreatedAt` anchors the partition
 * but is caller-supplied (`param.timestamps.created_at` in `routes/misc.ts`),
 * not stamped by our ingest boundary — a client sending arbitrary
 * `created_at` values controls partition spread and part count directly.
 * `upsertStep` keeps the first-write value, so it is frozen in practice, but
 * that does not make it platform-controlled; see `structuralDebt` below.
 */
const table = defineTable({
  name: "dspy_steps",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "ExperimentId", "RunId", "StepIndex"],
  partition: { by: "toYearWeek(CreatedAt)", column: "CreatedAt" },
  tenant: ["TenantId"],
  structuralDebt: [
    {
      column: "CreatedAt",
      reason:
        "CreatedAt is caller-supplied from the DSPy client's request body, not platform accept time, so a client controls this partition's spread and part count directly",
    },
  ],
  columns: {
    Id: ch.string(),
    TenantId: ch.string(),
    ExperimentId: ch.string(),
    RunId: ch.string(),
    StepIndex: ch.string(),
    WorkflowVersionId: ch.nullable(ch.string()),
    Score: ch.float64(),
    Label: ch.string(),
    OptimizerName: ch.string(),
    OptimizerParameters: ch.string(),
    Predictors: ch.string(),
    Examples: ch.string(),
    LlmCalls: ch.string(),
    LlmCallsTotal: ch.uint32(),
    LlmCallsTotalTokens: ch.uint64(),
    LlmCallsTotalCost: ch.float64(),
    CreatedAt: ch.occurredAt(),
    InsertedAt: ch.dateTime64(3),
    UpdatedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
  },
});

type Row = TableRow<typeof table.columns>;

const codec = createRowCodec();
const names = bindIdentifiers();

/** Aggregated read shape for `getStepsByExperiment` — one row per step. */
const SUMMARY_COLUMNS = {
  TenantId: ch.string(),
  ExperimentId: ch.string(),
  RunId: ch.string(),
  StepIndex: ch.string(),
  WorkflowVersionId: ch.nullable(ch.string()),
  Score: ch.float64(),
  Label: ch.string(),
  OptimizerName: ch.string(),
  LlmCallsTotal: ch.uint32(),
  LlmCallsTotalTokens: ch.uint64(),
  LlmCallsTotalCost: ch.float64(),
  CreatedAt: ch.dateTime64(3),
} as const;
type SummaryColumnName = keyof typeof SUMMARY_COLUMNS;
const SUMMARY_COLUMN_NAMES = Object.keys(
  SUMMARY_COLUMNS,
) as readonly SummaryColumnName[];
const SUMMARY_WIRE_COLUMNS = SUMMARY_COLUMN_NAMES.map(
  (name) => SUMMARY_COLUMNS[name],
);
type SummaryRow = { readonly [K in SummaryColumnName]: unknown };

function computeLlmSummary(llmCalls: DspyLlmCallData[]): {
  total: number;
  totalTokens: number;
  totalCost: number;
} {
  let totalTokens = 0;
  let totalCost = 0;
  for (const call of llmCalls) {
    totalTokens += (call.prompt_tokens ?? 0) + (call.completion_tokens ?? 0);
    totalCost += call.cost ?? 0;
  }
  return { total: llmCalls.length, totalTokens, totalCost };
}

function mergeByHash<T extends { hash: string }>(
  existing: T[],
  incoming: T[],
): T[] {
  const seen = new Set(existing.map((e) => e.hash));
  const merged = [...existing];
  for (const item of incoming) {
    if (!seen.has(item.hash)) {
      merged.push(item);
      seen.add(item.hash);
    }
  }
  return merged;
}

function toRow(args: {
  data: DspyStepData;
  examples: DspyExampleData[];
  llmCalls: DspyLlmCallData[];
  createdAt: number;
  insertedAt: number;
  retentionDays: number;
}): Row {
  const { data, examples, llmCalls, createdAt, insertedAt, retentionDays } =
    args;
  const summary = computeLlmSummary(llmCalls);
  return {
    Id: `${data.tenantId}/${data.runId}/${data.stepIndex}`,
    TenantId: data.tenantId,
    ExperimentId: data.experimentId,
    RunId: data.runId,
    StepIndex: data.stepIndex,
    WorkflowVersionId: data.workflowVersionId ?? null,
    Score: data.score,
    Label: data.label,
    OptimizerName: data.optimizerName,
    OptimizerParameters: JSON.stringify(data.optimizerParameters),
    Predictors: JSON.stringify(data.predictors),
    Examples: JSON.stringify(examples),
    LlmCalls: JSON.stringify(llmCalls),
    LlmCallsTotal: summary.total,
    LlmCallsTotalTokens: BigInt(summary.totalTokens),
    LlmCallsTotalCost: summary.totalCost,
    CreatedAt: new Date(createdAt),
    InsertedAt: new Date(insertedAt),
    UpdatedAt: new Date(data.updatedAt),
    _retention_days: retentionDays,
  };
}

function fromRow(row: Row): DspyStepData {
  return {
    tenantId: row.TenantId,
    experimentId: row.ExperimentId,
    runId: row.RunId,
    stepIndex: row.StepIndex,
    workflowVersionId: row.WorkflowVersionId,
    score: row.Score,
    label: row.Label,
    optimizerName: row.OptimizerName,
    optimizerParameters: JSON.parse(row.OptimizerParameters) as Record<
      string,
      unknown
    >,
    predictors: JSON.parse(row.Predictors) as DspyPredictorData[],
    examples: JSON.parse(row.Examples) as DspyExampleData[],
    llmCalls: JSON.parse(row.LlmCalls) as DspyLlmCallData[],
    createdAt: row.CreatedAt.getTime(),
    insertedAt: row.InsertedAt.getTime(),
    updatedAt: row.UpdatedAt.getTime(),
  };
}

export class DspyStepClickHouseRepository implements DspyStepRepository {
  constructor(
    private readonly resolveClient: (tenantId: string) => ClickHouseClient,
    // dspy_steps is a traces-category retention table. Without a resolver the
    // tenant's policy can't be read, so rows fall back to the platform default.
    private readonly retentionResolver: RetentionPolicyResolver | null = null,
  ) {}

  private async resolveTracesRetentionDays(tenantId: string): Promise<number> {
    const resolved = await this.retentionResolver?.resolve(tenantId);
    return resolved?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
  }

  private async writeRow(row: Row): Promise<void> {
    const encodedRows = codec.encodeRows({
      columns: table.wireColumns,
      columnNames: table.columnNames,
      rows: [row],
    });
    const client = this.resolveClient(row.TenantId);
    await client.insert({
      tenantId: row.TenantId,
      table: table.name,
      rows: encodedRows,
      columns: table.columnNames,
      target: { kind: "replacing" },
    });
  }

  /**
   * Direct insert without read-merge-write. Use for migration where the
   * source data is already complete and dedup is handled externally.
   */
  async insertStepDirect(data: DspyStepData): Promise<void> {
    const retentionDays = await this.resolveTracesRetentionDays(data.tenantId);
    const row = toRow({
      data,
      examples: data.examples,
      llmCalls: data.llmCalls,
      createdAt: data.createdAt,
      insertedAt: data.insertedAt,
      retentionDays,
    });
    await this.writeRow(row);
  }

  async upsertStep(data: DspyStepData): Promise<void> {
    try {
      const existing = await this.getStep(
        data.tenantId,
        data.experimentId,
        data.runId,
        data.stepIndex,
      );
      const retentionDays = await this.resolveTracesRetentionDays(
        data.tenantId,
      );

      const mergedExamples = existing
        ? mergeByHash(existing.examples, data.examples)
        : data.examples;
      const mergedLlmCalls = existing
        ? mergeByHash(existing.llmCalls, data.llmCalls)
        : data.llmCalls;

      const row = toRow({
        data,
        examples: mergedExamples,
        llmCalls: mergedLlmCalls,
        createdAt: existing?.createdAt ?? data.createdAt,
        insertedAt: existing?.insertedAt ?? data.insertedAt,
        retentionDays,
      });
      await this.writeRow(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        {
          tenantId: data.tenantId,
          runId: data.runId,
          stepIndex: data.stepIndex,
          error: errorMessage,
        },
        "Failed to upsert DSPy step in ClickHouse",
      );
      throw error;
    }
  }

  async getStepsByExperiment(
    tenantId: string,
    experimentId: string,
  ): Promise<DspyStepSummaryData[]> {
    try {
      const client = this.resolveClient(tenantId);
      // The table partitions on `toYearWeek(CreatedAt)`. Without a CreatedAt
      // bound the GROUP BY walks every weekly partition for the experiment,
      // including cold-tier S3 ones. The primary key
      // `(TenantId, ExperimentId, RunId, StepIndex)` makes the per-partition
      // scan cheap but the partition fan-out itself is the dominant cost.
      //
      // If/when a service-layer caller has access to the experiment's start
      // time, add an optional sinceMs and a CreatedAt lower bound here to
      // prune partitions. Avoiding the optional param until a real caller
      // wires it through; otherwise it's API surface that nobody uses.
      const result = await client.query({
        tenantId,
        sql: `
          SELECT
            TenantId,
            ExperimentId,
            RunId,
            StepIndex,
            argMax(WorkflowVersionId, UpdatedAt) AS WorkflowVersionId,
            argMax(Score, UpdatedAt) AS Score,
            argMax(Label, UpdatedAt) AS Label,
            argMax(OptimizerName, UpdatedAt) AS OptimizerName,
            argMax(LlmCallsTotal, UpdatedAt) AS LlmCallsTotal,
            argMax(LlmCallsTotalTokens, UpdatedAt) AS LlmCallsTotalTokens,
            argMax(LlmCallsTotalCost, UpdatedAt) AS LlmCallsTotalCost,
            min(CreatedAt) AS CreatedAt
          FROM ${names.of(table.name)}
          WHERE TenantId = {tenantId:String}
            AND ExperimentId = {experimentId:String}
          GROUP BY TenantId, ExperimentId, RunId, StepIndex
          ORDER BY CreatedAt ASC
          LIMIT 10000
        `,
        params: { ...names.params, tenantId, experimentId },
      });

      const rows = codec.decodeRows<SummaryRow>({
        columns: SUMMARY_WIRE_COLUMNS,
        columnNames: SUMMARY_COLUMN_NAMES,
        header: result.header,
        rows: result.rows,
      });

      return rows.map((row) => ({
        tenantId: row.TenantId as string,
        experimentId: row.ExperimentId as string,
        runId: row.RunId as string,
        stepIndex: row.StepIndex as string,
        workflowVersionId: row.WorkflowVersionId as string | null,
        score: row.Score as number,
        label: row.Label as string,
        optimizerName: row.OptimizerName as string,
        llmCallsTotal: row.LlmCallsTotal as number,
        llmCallsTotalTokens: Number(row.LlmCallsTotalTokens as bigint),
        llmCallsTotalCost: row.LlmCallsTotalCost as number,
        createdAt: (row.CreatedAt as Date).getTime(),
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, experimentId, error: errorMessage },
        "Failed to get DSPy steps from ClickHouse",
      );
      throw error;
    }
  }

  async getStep(
    tenantId: string,
    experimentId: string,
    runId: string,
    stepIndex: string,
  ): Promise<DspyStepData | null> {
    try {
      const client = this.resolveClient(tenantId);
      // IN-tuple dedup over the ReplacingMergeTree (see
      // dev/docs/best_practices/clickhouse-queries.md).
      const result = await client.query({
        tenantId,
        sql: `
          SELECT ${names.list(table.columnNames)}
          FROM ${names.of(table.name)} AS t
          WHERE t.TenantId = {tenantId:String}
            AND t.ExperimentId = {experimentId:String}
            AND t.RunId = {runId:String}
            AND t.StepIndex = {stepIndex:String}
            AND (t.TenantId, t.ExperimentId, t.RunId, t.StepIndex, t.UpdatedAt) IN (
              SELECT TenantId, ExperimentId, RunId, StepIndex, max(UpdatedAt)
              FROM ${names.of(table.name)}
              WHERE TenantId = {tenantId:String}
                AND ExperimentId = {experimentId:String}
                AND RunId = {runId:String}
                AND StepIndex = {stepIndex:String}
              GROUP BY TenantId, ExperimentId, RunId, StepIndex
            )
          LIMIT 1
        `,
        params: {
          ...names.params,
          tenantId,
          experimentId,
          runId,
          stepIndex,
        },
      });

      const [row] = codec.decodeRows<Row>({
        columns: table.wireColumns,
        columnNames: table.columnNames,
        header: result.header,
        rows: result.rows,
      });
      if (!row) return null;

      return fromRow(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, experimentId, runId, stepIndex, error: errorMessage },
        "Failed to get DSPy step from ClickHouse",
      );
      throw error;
    }
  }

  async deleteByExperiment(
    tenantId: string,
    experimentId: string,
  ): Promise<void> {
    try {
      const client = this.resolveClient(tenantId);
      await client.command({
        tenantId,
        sql: `DELETE FROM ${table.name} WHERE TenantId = {tenantId:String} AND ExperimentId = {experimentId:String}`,
        params: { tenantId, experimentId },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, experimentId, error: errorMessage },
        "Failed to delete DSPy steps from ClickHouse",
      );
      throw error;
    }
  }
}
