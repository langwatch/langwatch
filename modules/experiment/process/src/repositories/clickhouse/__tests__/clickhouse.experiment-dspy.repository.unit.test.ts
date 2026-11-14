import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import type { ExperimentDspyStep } from "@langwatch/experiment-contract";
import { describe, expect, it, vi } from "vitest";

import { ExperimentDspyRetentionRepository } from "../../experiment-dspy-retention.repository.ts";
import {
  ClickHouseExperimentDspyRepository,
  type ExperimentDspyClickHouseClient,
} from "../clickhouse.experiment-dspy.repository.ts";

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

class FixedRetention extends ExperimentDspyRetentionRepository {
  findTraceRetentionDays = vi.fn(async () => 49);
}

const telemetry = { warn: vi.fn() };

/** A client answering every built read with `rows`, recording each statement it is sent. */
function readingClient(rows: readonly Record<string, unknown>[]) {
  const statements: ReaderReadStatement[] = [];
  const insert = vi.fn<ExperimentDspyClickHouseClient["insert"]>(async () => undefined);
  const client = {
    insert,
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows };
    },
  };
  return { client: client as never, insert, statements };
}

function expectSingleTenantReads(statements: readonly ReaderReadStatement[]) {
  expect(statements.length).toBeGreaterThan(0);
  for (const statement of statements) {
    expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: "project_1" });
    expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project_1" });
    expect(statement.sql).toContain("WHERE TenantId = {tenantId:String}");
  }
}

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
      telemetry,
    });

    await expect(repository.upsert({ step: step(), retention })).resolves.toBeUndefined();
    await expect(
      repository.findAll({ tenantId: "project_1", experimentId: "experiment_1" }),
    ).resolves.toEqual([]);
    await expect(
      repository.findStep({
        tenantId: "project_1",
        experimentId: "experiment_1",
        runId: "run_1",
        stepIndex: "0",
      }),
    ).resolves.toBeNull();
    expect(retention.findTraceRetentionDays).not.toHaveBeenCalled();
  });

  it("merges examples and calls by hash while preserving first-write times", async () => {
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
      Examples: JSON.stringify([{ hash: "example_1", example: {}, pred: {}, score: 0.4 }]),
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
      LlmCallsTotalTokensText: "5",
      LlmCallsTotalCost: 0.1,
      CreatedAtMs: "1000",
      InsertedAtMs: "1100",
      UpdatedAtMs: "1200",
    };
    const { client, insert, statements } = readingClient([existing]);
    const repository = ClickHouseExperimentDspyRepository.create({
      resolveClient: async () => client,
      telemetry,
    });

    await repository.upsert({
      retention: new FixedRetention(),
      step: step({
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
    });

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
    expectSingleTenantReads(statements);
    expect(statements[0]?.sql).toContain("{{idBound:dspy_steps.ExperimentId,RunId:");
  });

  it("maps the existing summary response without changing its totals", async () => {
    const { client, statements } = readingClient([
      {
        TenantId: "project_1",
        ExperimentId: "experiment_1",
        RunId: "run_1",
        StepIndex: "0",
        LatestWorkflowVersionId: "version_1",
        LatestScore: 0.75,
        LatestLabel: "best",
        LatestOptimizerName: "MIPROv2",
        LatestLlmCallsTotal: 4,
        LatestLlmCallsTotalTokens: "123",
        LatestLlmCallsTotalCost: 0.45,
        FirstCreatedAtMs: "1000",
      },
    ]);
    const repository = ClickHouseExperimentDspyRepository.create({
      resolveClient: async () => client,
      telemetry,
    });

    await expect(
      repository.findAll({ tenantId: "project_1", experimentId: "experiment_1" }),
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
    expectSingleTenantReads(statements);
    expect(statements[0]?.sql).toContain("{{idBound:dspy_steps.ExperimentId:");
  });
});
