import type {
  ExperimentDspyExample,
  ExperimentDspyLlmCall,
  ExperimentDspyStep,
  ExperimentDspyStepLookup,
  ExperimentDspyStepSummary,
  ExperimentDspyStepsLookup,
} from "@langwatch/experiment-contract";
import type { ExperimentDspyRetentionPort } from "../../ports/experiment-dspy-retention.port";
import { ExperimentDspyRepository } from "../experiment-dspy.repository";

const TABLE_NAME = "dspy_steps";

export type ExperimentDspyClickHouseResult = {
  json<T>(): Promise<T[]>;
};

export type ExperimentDspyClickHouseClient = {
  insert(input: {
    table: string;
    values: unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: {
      async_insert?: 0 | 1;
      wait_for_async_insert?: 0 | 1;
    };
  }): Promise<unknown>;
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<ExperimentDspyClickHouseResult>;
};

export type ExperimentDspyClickHouseResolver = (
  tenantId: string,
) => Promise<ExperimentDspyClickHouseClient | null>;

export type ExperimentDspyTelemetry = {
  warn(input: { projectId: string; error: unknown }, message: string): void;
};

type ExperimentDspyRow = {
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
  LlmCallsTotalTokens: string;
  LlmCallsTotalCost: number;
  CreatedAt: string;
  InsertedAt: string;
  UpdatedAt: string;
};

type ExperimentDspySummaryRow = Pick<
  ExperimentDspyRow,
  | "TenantId"
  | "ExperimentId"
  | "RunId"
  | "StepIndex"
  | "WorkflowVersionId"
  | "Score"
  | "Label"
  | "OptimizerName"
  | "LlmCallsTotal"
  | "LlmCallsTotalTokens"
  | "LlmCallsTotalCost"
  | "CreatedAt"
>;

function mergeByHash<T extends { hash: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((item) => item.hash));
  return [
    ...existing,
    ...incoming.filter((item) => {
      if (seen.has(item.hash)) return false;
      seen.add(item.hash);
      return true;
    }),
  ];
}

function llmSummary(calls: ExperimentDspyLlmCall[]): {
  total: number;
  tokens: number;
  cost: number;
} {
  return calls.reduce(
    (total, call) => ({
      total: total.total + 1,
      tokens: total.tokens + (call.prompt_tokens ?? 0) + (call.completion_tokens ?? 0),
      cost: total.cost + (call.cost ?? 0),
    }),
    { total: 0, tokens: 0, cost: 0 },
  );
}

export class ClickHouseExperimentDspyRepository extends ExperimentDspyRepository {
  static create(options: {
    resolveClient: ExperimentDspyClickHouseResolver;
    retention: ExperimentDspyRetentionPort;
    telemetry: ExperimentDspyTelemetry;
  }): ClickHouseExperimentDspyRepository {
    return new ClickHouseExperimentDspyRepository(options);
  }

  private constructor(
    private readonly options: {
      resolveClient: ExperimentDspyClickHouseResolver;
      retention: ExperimentDspyRetentionPort;
      telemetry: ExperimentDspyTelemetry;
    },
  ) {
    super();
  }

  async upsert(input: ExperimentDspyStep): Promise<void> {
    try {
      const client = await this.options.resolveClient(input.tenantId);
      if (!client) return;
      const existing = await this.tryGetWithClient(client, input);
      const examples = mergeByHash<ExperimentDspyExample>(
        existing?.examples ?? [],
        input.examples,
      );
      const llmCalls = mergeByHash<ExperimentDspyLlmCall>(
        existing?.llmCalls ?? [],
        input.llmCalls,
      );
      const summary = llmSummary(llmCalls);
      const retentionDays = await this.options.retention.getTraceRetentionDays(
        input.tenantId,
      );

      await client.insert({
        table: TABLE_NAME,
        values: [
          {
            Id: `${input.tenantId}/${input.runId}/${input.stepIndex}`,
            TenantId: input.tenantId,
            ExperimentId: input.experimentId,
            RunId: input.runId,
            StepIndex: input.stepIndex,
            WorkflowVersionId: input.workflowVersionId ?? null,
            Score: input.score,
            Label: input.label,
            OptimizerName: input.optimizerName,
            OptimizerParameters: JSON.stringify(input.optimizerParameters),
            Predictors: JSON.stringify(input.predictors),
            Examples: JSON.stringify(examples),
            LlmCalls: JSON.stringify(llmCalls),
            LlmCallsTotal: summary.total,
            LlmCallsTotalTokens: summary.tokens,
            LlmCallsTotalCost: summary.cost,
            CreatedAt: new Date(existing?.createdAt ?? input.createdAt),
            InsertedAt: new Date(existing?.insertedAt ?? input.insertedAt),
            UpdatedAt: new Date(input.updatedAt),
            _retention_days: retentionDays,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      this.options.telemetry.warn(
        { projectId: input.tenantId, error },
        "Failed to upsert Experiment DSPy step in ClickHouse",
      );
      throw error;
    }
  }

  async list(input: ExperimentDspyStepsLookup): Promise<ExperimentDspyStepSummary[]> {
    try {
      const client = await this.options.resolveClient(input.tenantId);
      if (!client) return [];
      const result = await client.query({
        query: `
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
            toString(argMax(LlmCallsTotalTokens, UpdatedAt)) AS LlmCallsTotalTokens,
            argMax(LlmCallsTotalCost, UpdatedAt) AS LlmCallsTotalCost,
            toString(toUnixTimestamp64Milli(min(CreatedAt))) AS CreatedAt
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND ExperimentId = {experimentId:String}
          GROUP BY TenantId, ExperimentId, RunId, StepIndex
          ORDER BY CreatedAt ASC
          LIMIT 10000
        `,
        query_params: input,
        format: "JSONEachRow",
      });
      return (await result.json<ExperimentDspySummaryRow>()).map((row) => ({
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
      this.options.telemetry.warn(
        { projectId: input.tenantId, error },
        "Failed to list Experiment DSPy steps from ClickHouse",
      );
      throw error;
    }
  }

  async tryGet(input: ExperimentDspyStepLookup): Promise<ExperimentDspyStep | null> {
    try {
      const client = await this.options.resolveClient(input.tenantId);
      if (!client) return null;
      return this.tryGetWithClient(client, input);
    } catch (error) {
      this.options.telemetry.warn(
        { projectId: input.tenantId, error },
        "Failed to read Experiment DSPy step from ClickHouse",
      );
      throw error;
    }
  }

  private async tryGetWithClient(
    client: ExperimentDspyClickHouseClient,
    input: ExperimentDspyStepLookup,
  ): Promise<ExperimentDspyStep | null> {
    const result = await client.query({
      query: `
        SELECT
          t.TenantId AS TenantId,
          t.ExperimentId AS ExperimentId,
          t.RunId AS RunId,
          t.StepIndex AS StepIndex,
          t.WorkflowVersionId AS WorkflowVersionId,
          t.Score AS Score,
          t.Label AS Label,
          t.OptimizerName AS OptimizerName,
          t.OptimizerParameters AS OptimizerParameters,
          t.Predictors AS Predictors,
          t.Examples AS Examples,
          t.LlmCalls AS LlmCalls,
          t.LlmCallsTotal AS LlmCallsTotal,
          toString(t.LlmCallsTotalTokens) AS LlmCallsTotalTokens,
          t.LlmCallsTotalCost AS LlmCallsTotalCost,
          toString(toUnixTimestamp64Milli(t.CreatedAt)) AS CreatedAt,
          toString(toUnixTimestamp64Milli(t.InsertedAt)) AS InsertedAt,
          toString(toUnixTimestamp64Milli(t.UpdatedAt)) AS UpdatedAt
        FROM ${TABLE_NAME} AS t
        WHERE t.TenantId = {tenantId:String}
          AND t.ExperimentId = {experimentId:String}
          AND t.RunId = {runId:String}
          AND t.StepIndex = {stepIndex:String}
          AND (t.TenantId, t.ExperimentId, t.RunId, t.StepIndex, t.UpdatedAt) IN (
            SELECT TenantId, ExperimentId, RunId, StepIndex, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND ExperimentId = {experimentId:String}
              AND RunId = {runId:String}
              AND StepIndex = {stepIndex:String}
            GROUP BY TenantId, ExperimentId, RunId, StepIndex
          )
        LIMIT 1
      `,
      query_params: input,
      format: "JSONEachRow",
    });
    const row = (await result.json<ExperimentDspyRow>())[0];
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
  }
}
