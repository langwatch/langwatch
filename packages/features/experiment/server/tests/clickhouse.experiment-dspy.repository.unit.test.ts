import type { ExperimentDspyStep } from "@langwatch/experiment-contract";
import { describe, expect, it, vi } from "vitest";
import {
  ClickHouseExperimentDspyRepository,
  type ExperimentDspyClickHouseResult,
  type ExperimentDspyClickHouseClient,
} from "../src/repositories/clickhouse/clickhouse.experiment-dspy.repository";
import { ExperimentDspyRetentionPort } from "../src/ports/experiment-dspy-retention.port";

const step = (overrides: Partial<ExperimentDspyStep> = {}): ExperimentDspyStep => ({
  tenantId: "project_1",
  experimentId: "experiment_1",
  runId: "run_1",
  stepIndex: "0",
  score: 0.5,
  label: "score",
  optimizerName: "MIPROv2",
  optimizerParameters: {},
  predictors: [],
  examples: [],
  llmCalls: [],
  createdAt: 1_000,
  insertedAt: 1_100,
  updatedAt: 1_200,
  ...overrides,
});

class FixedRetention extends ExperimentDspyRetentionPort {
  getTraceRetentionDays = vi.fn(async () => 49);
}

const telemetry = { warn: vi.fn() };

const clickHouseResult = <T>(rows: T[]): ExperimentDspyClickHouseResult => ({
  json: async <Requested>() => rows as unknown as Requested[],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new Error("expected a string ClickHouse field");
  }
  return value;
};

describe("ClickHouseExperimentDspyRepository", () => {
  it("degrades cleanly without ClickHouse", async () => {
    const retention = new FixedRetention();
    const repository = ClickHouseExperimentDspyRepository.create({
      resolveClient: async () => null,
      retention,
      telemetry,
    });

    await expect(repository.upsert(step())).resolves.toBeUndefined();
    await expect(
      repository.list({ tenantId: "project_1", experimentId: "experiment_1" }),
    ).resolves.toEqual([]);
    await expect(
      repository.tryGet({
        tenantId: "project_1",
        experimentId: "experiment_1",
        runId: "run_1",
        stepIndex: "0",
      }),
    ).resolves.toBeNull();
    expect(retention.getTraceRetentionDays).not.toHaveBeenCalled();
  });

  it("merges examples and calls by hash while preserving first-write times", async () => {
    const insert = vi.fn<ExperimentDspyClickHouseClient["insert"]>(async () => undefined);
    const existing = {
      TenantId: "project_1",
      ExperimentId: "experiment_1",
      RunId: "run_1",
      StepIndex: "0",
      WorkflowVersionId: null,
      Score: 0.4,
      Label: "old",
      OptimizerName: "MIPROv2",
      OptimizerParameters: "{}",
      Predictors: "[]",
      Examples: JSON.stringify([
        { hash: "example_1", example: {}, pred: {}, score: 0.4 },
      ]),
      LlmCalls: JSON.stringify([
        {
          hash: "call_1",
          __class__: "LM",
          response: {},
          prompt_tokens: 2,
          completion_tokens: 3,
          cost: 0.1,
        },
      ]),
      LlmCallsTotal: 1,
      LlmCallsTotalTokens: "5",
      LlmCallsTotalCost: 0.1,
      CreatedAt: "1000",
      InsertedAt: "1100",
      UpdatedAt: "1200",
    };
    const client: ExperimentDspyClickHouseClient = {
      insert,
      query: vi.fn(async () => clickHouseResult([existing])),
    };
    const repository = ClickHouseExperimentDspyRepository.create({
      resolveClient: async () => client,
      retention: new FixedRetention(),
      telemetry,
    });

    await repository.upsert(
      step({
        examples: [
          { hash: "example_1", example: {}, pred: {}, score: 0.4 },
          { hash: "example_2", example: {}, pred: {}, score: 0.6 },
        ],
        llmCalls: [
          { hash: "call_1", __class__: "LM", response: {} },
          {
            hash: "call_2",
            __class__: "LM",
            response: {},
            prompt_tokens: 7,
            completion_tokens: 11,
            cost: 0.2,
          },
        ],
        updatedAt: 2_000,
      }),
    );

    const written = insert.mock.calls[0]?.[0]?.values[0];
    expect(written).toBeDefined();
    if (!isRecord(written)) throw new Error("expected an inserted row");
    expect(JSON.parse(asString(written.Examples))).toHaveLength(2);
    expect(JSON.parse(asString(written.LlmCalls))).toHaveLength(2);
    expect(written.LlmCallsTotalTokens).toBe(23);
    expect(written.LlmCallsTotalCost).toBeCloseTo(0.3);
    expect(written.CreatedAt).toEqual(new Date(1_000));
    expect(written.InsertedAt).toEqual(new Date(1_100));
    expect(written.UpdatedAt).toEqual(new Date(2_000));
    expect(written._retention_days).toBe(49);
  });

  it("maps the existing summary response without changing its totals", async () => {
    const client: ExperimentDspyClickHouseClient = {
      insert: vi.fn(async () => undefined),
      query: vi.fn(async () =>
        clickHouseResult([
          {
            TenantId: "project_1",
            ExperimentId: "experiment_1",
            RunId: "run_1",
            StepIndex: "0",
            WorkflowVersionId: "version_1",
            Score: 0.75,
            Label: "best",
            OptimizerName: "MIPROv2",
            LlmCallsTotal: 4,
            LlmCallsTotalTokens: "123",
            LlmCallsTotalCost: 0.45,
            CreatedAt: "1000",
          },
        ]),
      ),
    };
    const repository = ClickHouseExperimentDspyRepository.create({
      resolveClient: async () => client,
      retention: new FixedRetention(),
      telemetry,
    });

    await expect(
      repository.list({ tenantId: "project_1", experimentId: "experiment_1" }),
    ).resolves.toEqual([
      {
        tenantId: "project_1",
        experimentId: "experiment_1",
        runId: "run_1",
        stepIndex: "0",
        workflowVersionId: "version_1",
        score: 0.75,
        label: "best",
        optimizerName: "MIPROv2",
        llmCallsTotal: 4,
        llmCallsTotalTokens: 123,
        llmCallsTotalCost: 0.45,
        createdAt: 1_000,
      },
    ]);
  });
});
