import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  type ColumnRef,
  fn,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import {
  experimentDspyStepSchema,
  experimentDspyStepSummarySchema,
  type ExperimentDspyExample,
  type ExperimentDspyLlmCall,
  type ExperimentDspyStep,
  type ExperimentDspyStepLookup,
  type ExperimentDspyStepSummary,
  type ExperimentDspyStepsLookup,
} from "@langwatch/experiment-contract";
import { Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

import { llmSummary, mergeByHash } from "../../rules/experiment-dspy-step.rules.ts";
import type { ExperimentDspyRetentionRepository } from "../experiment-dspy-retention.repository.ts";
import { ExperimentDspyRepository } from "../experiment-dspy.repository.ts";
import { dspySteps as steps } from "./clickhouse.dspy-steps.table.ts";

/**
 * Epoch millis as the value the ClickHouse client binds to a `DateTime64(3)`.
 * The client serialises a `Date`; an instant serialises to `{}`, so the
 * conversion happens here and nowhere above.
 */
function clickHouseDateTime(epochMs: number): ReturnType<typeof toDate> {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

const TABLE_NAME = "dspy_steps";
const experimentDspyStepSummariesSchema = experimentDspyStepSummarySchema.array();

export type ExperimentDspyClickHouseClient = Pick<ClickHouseQueryClient, "read"> & {
  insert(input: {
    table: string;
    values: unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: {
      async_insert?: 0 | 1;
      wait_for_async_insert?: 0 | 1;
    };
  }): Promise<unknown>;
};

type ExperimentDspyClickHouseResolver = (
  tenantId: string,
) => Promise<ExperimentDspyClickHouseClient | null>;

type ExperimentDspyTelemetry = {
  warn(input: { projectId: string; error: unknown }, message: string): void;
};

const dspyRowSchema = z.object({
  TenantId: z.string(),
  ExperimentId: z.string(),
  RunId: z.string(),
  StepIndex: z.string(),
  WorkflowVersionId: z.string().nullable(),
  Score: z.number(),
  Label: z.string(),
  OptimizerName: z.string(),
  OptimizerParameters: z.string(),
  Predictors: z.string(),
  Examples: z.string(),
  LlmCalls: z.string(),
  LlmCallsTotal: z.number(),
  LlmCallsTotalTokensText: z.string(),
  LlmCallsTotalCost: z.number(),
  CreatedAtMs: z.string(),
  InsertedAtMs: z.string(),
  UpdatedAtMs: z.string(),
});
const dspyRowsSchema = z.array(dspyRowSchema);

/** A step's latest values per column, under `Latest…` keys: no alias takes a column's name. */
const dspySummaryRowsSchema = z.array(
  z.object({
    TenantId: z.string(),
    ExperimentId: z.string(),
    RunId: z.string(),
    StepIndex: z.string(),
    LatestWorkflowVersionId: z.string().nullable(),
    LatestScore: z.number(),
    LatestLabel: z.string(),
    LatestOptimizerName: z.string(),
    LatestLlmCallsTotal: z.number(),
    LatestLlmCallsTotalTokens: z.string(),
    LatestLlmCallsTotalCost: z.number(),
    FirstCreatedAtMs: z.string(),
  }),
);

export class ClickHouseExperimentDspyRepository extends ExperimentDspyRepository {
  static create(options: {
    resolveClient: ExperimentDspyClickHouseResolver;
    telemetry: ExperimentDspyTelemetry;
  }): ClickHouseExperimentDspyRepository {
    return new ClickHouseExperimentDspyRepository(options);
  }

  private constructor(
    private readonly options: {
      resolveClient: ExperimentDspyClickHouseResolver;
      telemetry: ExperimentDspyTelemetry;
    },
  ) {
    super();
  }

  async upsert({
    step: input,
    retention,
  }: {
    step: ExperimentDspyStep;
    retention: ExperimentDspyRetentionRepository;
  }): Promise<void> {
    try {
      const client = await this.options.resolveClient(input.tenantId);
      if (!client) return;
      const existing = await this.findWithClient({ client, input });
      const examples = mergeByHash<ExperimentDspyExample>(existing?.examples ?? [], input.examples);
      const llmCalls = mergeByHash<ExperimentDspyLlmCall>(existing?.llmCalls ?? [], input.llmCalls);
      const summary = llmSummary(llmCalls);
      const retentionDays = await retention.findTraceRetentionDays(input.tenantId);

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
            CreatedAt: clickHouseDateTime(existing?.createdAt ?? input.createdAt),
            InsertedAt: clickHouseDateTime(existing?.insertedAt ?? input.insertedAt),
            UpdatedAt: clickHouseDateTime(input.updatedAt),
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

  async findAll(input: ExperimentDspyStepsLookup): Promise<ExperimentDspyStepSummary[]> {
    try {
      const client = await this.options.resolveClient(input.tenantId);
      if (!client) return [];
      const latest = <V>(of: ColumnRef<"dspy_steps", string, V>) => fn.argMax(of, steps.UpdatedAt);
      const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
        .from(steps)
        .select({
          TenantId: steps.TenantId,
          ExperimentId: steps.ExperimentId,
          RunId: steps.RunId,
          StepIndex: steps.StepIndex,
          LatestWorkflowVersionId: latest(steps.WorkflowVersionId),
          LatestScore: latest(steps.Score),
          LatestLabel: latest(steps.Label),
          LatestOptimizerName: latest(steps.OptimizerName),
          LatestLlmCallsTotal: latest(steps.LlmCallsTotal),
          LatestLlmCallsTotalTokens: fn.toString(latest(steps.LlmCallsTotalTokens)),
          LatestLlmCallsTotalCost: latest(steps.LlmCallsTotalCost),
          FirstCreatedAtMs: fn.toString(fn.toUnixTimestamp64Milli(fn.min(steps.CreatedAt))),
        })
        .where(({ idBound }) => idBound(steps.ExperimentId, input.experimentId))
        .groupBy(steps.TenantId, steps.ExperimentId, steps.RunId, steps.StepIndex)
        .orderBy(fn.min(steps.CreatedAt), "ASC")
        .limit(10_000)
        .build();
      const { rows: found } = await client.read({
        statement,
        idBound: { fallback: "unbounded" },
      });
      const rows = dspySummaryRowsSchema.parse(found);
      return experimentDspyStepSummariesSchema.parse(
        rows.map((row) => ({
          tenantId: row.TenantId,
          experimentId: row.ExperimentId,
          runId: row.RunId,
          stepIndex: row.StepIndex,
          workflowVersionId: row.LatestWorkflowVersionId,
          score: row.LatestScore,
          label: row.LatestLabel,
          optimizerName: row.LatestOptimizerName,
          llmCallsTotal: row.LatestLlmCallsTotal,
          llmCallsTotalTokens: Number(row.LatestLlmCallsTotalTokens),
          llmCallsTotalCost: row.LatestLlmCallsTotalCost,
          createdAt: Number(row.FirstCreatedAtMs),
        })),
      );
    } catch (error) {
      this.options.telemetry.warn(
        { projectId: input.tenantId, error },
        "Failed to list Experiment DSPy steps from ClickHouse",
      );
      throw error;
    }
  }

  async findStep(input: ExperimentDspyStepLookup): Promise<ExperimentDspyStep | null> {
    try {
      const client = await this.options.resolveClient(input.tenantId);
      if (!client) return null;
      const step = await this.findWithClient({ client, input });
      return step === null ? null : experimentDspyStepSchema.parse(step);
    } catch (error) {
      this.options.telemetry.warn(
        { projectId: input.tenantId, error },
        "Failed to read Experiment DSPy step from ClickHouse",
      );
      throw error;
    }
  }

  private async findWithClient({
    client,
    input,
  }: {
    client: ExperimentDspyClickHouseClient;
    input: ExperimentDspyStepLookup;
  }): Promise<ExperimentDspyStep | null> {
    const { tenantId, experimentId, runId, stepIndex } = input;
    const millisText = (of: ColumnRef<"dspy_steps", string, number>) =>
      fn.toString(fn.toUnixTimestamp64Milli(of));
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(steps)
      .select({
        TenantId: steps.TenantId,
        ExperimentId: steps.ExperimentId,
        RunId: steps.RunId,
        StepIndex: steps.StepIndex,
        WorkflowVersionId: steps.WorkflowVersionId,
        Score: steps.Score,
        Label: steps.Label,
        OptimizerName: steps.OptimizerName,
        OptimizerParameters: steps.OptimizerParameters,
        Predictors: steps.Predictors,
        Examples: steps.Examples,
        LlmCalls: steps.LlmCalls,
        LlmCallsTotal: steps.LlmCallsTotal,
        LlmCallsTotalTokensText: fn.toString(steps.LlmCallsTotalTokens),
        LlmCallsTotalCost: steps.LlmCallsTotalCost,
        CreatedAtMs: millisText(steps.CreatedAt),
        InsertedAtMs: millisText(steps.InsertedAt),
        UpdatedAtMs: millisText(steps.UpdatedAt),
      })
      .where(({ and, eq, idBoundKeys }) =>
        and(
          idBoundKeys([steps.ExperimentId, experimentId], [steps.RunId, runId]),
          eq(steps.StepIndex, stepIndex),
        ),
      )
      .latestVersion()
      .limit(1)
      .build();
    const { rows: found } = await client.read({ statement, idBound: { fallback: "unbounded" } });
    const row = dspyRowsSchema.parse(found)[0];
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
      createdAt: Number(row.CreatedAtMs),
      insertedAt: Number(row.InsertedAtMs),
      updatedAt: Number(row.UpdatedAtMs),
    };
  }
}
