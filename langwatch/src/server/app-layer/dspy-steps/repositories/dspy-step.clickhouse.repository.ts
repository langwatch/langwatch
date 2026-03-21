import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { createLogger } from "~/utils/logger/server";
import type {
  DspyStepData,
  DspyStepSummaryData,
  DspyExampleData,
  DspyLlmCallData,
} from "../types";
import type { DspyStepRepository } from "./dspy-step.repository";

const TABLE_NAME = "dspy_steps" as const;

const logger = createLogger(
  "langwatch:app-layer:dspy-steps:dspy-step-repository",
);

interface ClickHouseRecord {
  Id: string;
  TenantId: string;
  ExperimentId: string;
  RunId: string;
  StepIndex: string;
  WorkflowVersionId: string | null;
  Score: number;
  Label: string;
  OptimizerName: string;
  OptimizerParameters: string;
  Predictors: string;
  Examples: string;
  LlmCalls: string;
  LlmCallsTotal: number;
  LlmCallsTotalTokens: number;
  LlmCallsTotalCost: number;
  CreatedAt: number;
  InsertedAt: number;
  UpdatedAt: number;
}

type ClickHouseWriteRecord = WithDateWrites<
  ClickHouseRecord,
  "CreatedAt" | "InsertedAt" | "UpdatedAt"
>;

interface ClickHouseSummaryRow {
  TenantId: string;
  ExperimentId: string;
  RunId: string;
  StepIndex: string;
  WorkflowVersionId: string | null;
  Score: number;
  Label: string;
  OptimizerName: string;
  LlmCallsTotal: number;
  LlmCallsTotalTokens: string;
  LlmCallsTotalCost: number;
  CreatedAt: string;
}

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

export class DspyStepClickHouseRepository implements DspyStepRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsertStep(data: DspyStepData): Promise<void> {
    try {
      const existing = await this.getStep(
        data.tenantId,
        data.experimentId,
        data.runId,
        data.stepIndex,
      );

      let mergedExamples: DspyExampleData[];
      let mergedLlmCalls: DspyLlmCallData[];

      if (existing) {
        mergedExamples = mergeByHash(existing.examples, data.examples);
        mergedLlmCalls = mergeByHash(existing.llmCalls, data.llmCalls);
      } else {
        mergedExamples = data.examples;
        mergedLlmCalls = data.llmCalls;
      }

      const summary = computeLlmSummary(mergedLlmCalls);
      const id = `${data.tenantId}/${data.runId}/${data.stepIndex}`;

      const record: ClickHouseWriteRecord = {
        Id: id,
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
        Examples: JSON.stringify(mergedExamples),
        LlmCalls: JSON.stringify(mergedLlmCalls),
        LlmCallsTotal: summary.total,
        LlmCallsTotalTokens: summary.totalTokens,
        LlmCallsTotalCost: summary.totalCost,
        CreatedAt: new Date(existing?.createdAt ?? data.createdAt),
        InsertedAt: new Date(existing?.insertedAt ?? data.insertedAt),
        UpdatedAt: new Date(data.updatedAt),
      };

      const client = await this.resolveClient(data.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
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
      const client = await this.resolveClient(tenantId);
      const result = await client.query({
        query: `
          SELECT
            TenantId,
            ExperimentId,
            RunId,
            StepIndex,
            WorkflowVersionId,
            Score,
            Label,
            OptimizerName,
            LlmCallsTotal,
            toString(LlmCallsTotalTokens) AS LlmCallsTotalTokens,
            LlmCallsTotalCost,
            toString(toUnixTimestamp64Milli(CreatedAt)) AS CreatedAt
          FROM ${TABLE_NAME} FINAL
          WHERE TenantId = {tenantId:String}
            AND ExperimentId = {experimentId:String}
          ORDER BY CreatedAt ASC
        `,
        query_params: { tenantId, experimentId },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseSummaryRow>();
      return rows.map((row) => ({
        tenantId: row.TenantId,
        experimentId: row.ExperimentId,
        runId: row.RunId,
        stepIndex: row.StepIndex,
        workflowVersionId: row.WorkflowVersionId,
        score: row.Score,
        label: row.Label,
        optimizerName: row.OptimizerName,
        llmCallsTotal: row.LlmCallsTotal,
        llmCallsTotalTokens: Number(row.LlmCallsTotalTokens),
        llmCallsTotalCost: row.LlmCallsTotalCost,
        createdAt: Number(row.CreatedAt),
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
      const client = await this.resolveClient(tenantId);
      const result = await client.query({
        query: `
          SELECT
            Id,
            TenantId,
            ExperimentId,
            RunId,
            StepIndex,
            WorkflowVersionId,
            Score,
            Label,
            OptimizerName,
            OptimizerParameters,
            Predictors,
            Examples,
            LlmCalls,
            LlmCallsTotal,
            toString(LlmCallsTotalTokens) AS LlmCallsTotalTokens,
            LlmCallsTotalCost,
            toString(toUnixTimestamp64Milli(CreatedAt)) AS CreatedAt,
            toString(toUnixTimestamp64Milli(InsertedAt)) AS InsertedAt,
            toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt
          FROM ${TABLE_NAME} FINAL
          WHERE TenantId = {tenantId:String}
            AND ExperimentId = {experimentId:String}
            AND RunId = {runId:String}
            AND StepIndex = {stepIndex:String}
          ORDER BY UpdatedAt DESC
          LIMIT 1
        `,
        query_params: { tenantId, experimentId, runId, stepIndex },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseRecord>();
      const row = rows[0];
      if (!row) return null;

      return {
        tenantId: row.TenantId,
        experimentId: row.ExperimentId,
        runId: row.RunId,
        stepIndex: row.StepIndex,
        workflowVersionId: row.WorkflowVersionId,
        score: row.Score,
        label: row.Label,
        optimizerName: row.OptimizerName,
        optimizerParameters: JSON.parse(row.OptimizerParameters),
        predictors: JSON.parse(row.Predictors),
        examples: JSON.parse(row.Examples),
        llmCalls: JSON.parse(row.LlmCalls),
        createdAt: Number(row.CreatedAt),
        insertedAt: Number(row.InsertedAt),
        updatedAt: Number(row.UpdatedAt),
      };
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
      const client = await this.resolveClient(tenantId);
      await client.command({
        query: `DELETE FROM ${TABLE_NAME} WHERE TenantId = {tenantId:String} AND ExperimentId = {experimentId:String}`,
        query_params: { tenantId, experimentId },
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
