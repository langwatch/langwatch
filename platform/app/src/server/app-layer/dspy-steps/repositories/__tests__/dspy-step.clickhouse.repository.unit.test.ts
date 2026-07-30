import type { ClickHouseClient } from "@langwatch/clickhouse";
import { describe, expect, it, vi } from "vitest";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "~/server/data-retention/retentionPolicyResolver";
import type { DspyStepData } from "../../types";
import { DspyStepClickHouseRepository } from "../dspy-step.clickhouse.repository";

const COLUMN_NAMES = [
  "Id",
  "TenantId",
  "ExperimentId",
  "RunId",
  "StepIndex",
  "WorkflowVersionId",
  "Score",
  "Label",
  "OptimizerName",
  "OptimizerParameters",
  "Predictors",
  "Examples",
  "LlmCalls",
  "LlmCallsTotal",
  "LlmCallsTotalTokens",
  "LlmCallsTotalCost",
  "CreatedAt",
  "InsertedAt",
  "UpdatedAt",
  "_retention_days",
];
const RETENTION_INDEX = COLUMN_NAMES.indexOf("_retention_days");

function makeStep(overrides: Partial<DspyStepData> = {}): DspyStepData {
  return {
    tenantId: "project-1",
    experimentId: "exp-1",
    runId: "run-1",
    stepIndex: "0",
    score: 0.5,
    label: "score",
    optimizerName: "foo",
    optimizerParameters: {},
    predictors: [],
    examples: [],
    llmCalls: [],
    createdAt: 1000,
    insertedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function resolverReturning(traces: number | null): RetentionPolicyResolver {
  return {
    resolve: vi
      .fn()
      .mockResolvedValue(
        traces === null ? null : { traces, scenarios: 0, experiments: 0 },
      ),
  };
}

/** getStep() runs before every upsert; an empty result means "no existing row". */
function setup(resolver: RetentionPolicyResolver | null) {
  const insert = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const resolveClient = vi
    .fn()
    .mockReturnValue({ insert, query } as unknown as ClickHouseClient);
  const repo = new DspyStepClickHouseRepository(resolveClient, resolver);
  const insertedRow = (): unknown[] => insert.mock.calls[0]![0].rows[0];
  const insertedRetentionDays = () => insertedRow()[RETENTION_INDEX];
  return {
    repo,
    resolveClient,
    insert,
    query,
    insertedRow,
    insertedRetentionDays,
  };
}

describe("DspyStepClickHouseRepository", () => {
  describe("retention stamping", () => {
    describe("given the project has a traces retention policy", () => {
      /** @scenario Trace pipeline stamps _retention_days from traces category */
      it("stamps the resolved traces retention on upsertStep", async () => {
        const { repo, insertedRetentionDays } = setup(resolverReturning(49));

        await repo.upsertStep(makeStep());

        expect(insertedRetentionDays()).toBe(49);
      });

      it("stamps the resolved traces retention on insertStepDirect", async () => {
        const { repo, insertedRetentionDays } = setup(resolverReturning(49));

        await repo.insertStepDirect(makeStep());

        expect(insertedRetentionDays()).toBe(49);
      });
    });

    describe("given the project has no retention policy", () => {
      it("stamps the platform default on upsertStep", async () => {
        const { repo, insertedRetentionDays } = setup(resolverReturning(null));

        await repo.upsertStep(makeStep());

        expect(insertedRetentionDays()).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
      });
    });

    describe("given no retention resolver is wired", () => {
      it("falls back to the platform default", async () => {
        const { repo, insertedRetentionDays } = setup(null);

        await repo.upsertStep(makeStep());

        expect(insertedRetentionDays()).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
      });
    });
  });

  describe("insertStepDirect", () => {
    /** @scenario dspy_steps's CreatedAt still encodes to the same DateTime64(3) wire value */
    it("still encodes CreatedAt to the same DateTime64(3) wire string as the acceptedAt-labelled declaration did", async () => {
      const { repo, insertedRow } = setup(resolverReturning(45));

      await repo.insertStepDirect(makeStep({ createdAt: 1_705_314_600_123 }));

      const row = insertedRow();
      expect(row[COLUMN_NAMES.indexOf("CreatedAt")]).toBe(
        "2024-01-15 10:30:00.123",
      );
    });

    /** @scenario Writes are positional, matching the declared column order */
    it("writes the full row as a positional wire array", async () => {
      const { repo, insert, insertedRow } = setup(resolverReturning(45));

      await repo.insertStepDirect(
        makeStep({
          workflowVersionId: "wfv-1",
          predictors: [{ name: "p1", predictor: {} }],
          llmCalls: [
            {
              hash: "h1",
              __class__: "LM",
              response: {},
              prompt_tokens: 10,
              completion_tokens: 5,
              cost: 0.01,
            },
          ],
        }),
      );

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-1",
          table: "dspy_steps",
          columns: COLUMN_NAMES,
          target: { kind: "replacing" },
        }),
      );
      const row = insertedRow();
      expect(row).toEqual([
        "project-1/run-1/0",
        "project-1",
        "exp-1",
        "run-1",
        "0",
        "wfv-1",
        0.5,
        "score",
        "foo",
        "{}",
        JSON.stringify([{ name: "p1", predictor: {} }]),
        "[]",
        JSON.stringify([
          {
            hash: "h1",
            __class__: "LM",
            response: {},
            prompt_tokens: 10,
            completion_tokens: 5,
            cost: 0.01,
          },
        ]),
        1,
        "15",
        0.01,
        "1970-01-01 00:00:01.000",
        "1970-01-01 00:00:01.000",
        "1970-01-01 00:00:01.000",
        45,
      ]);
    });
  });

  describe("getStep", () => {
    /** @scenario Reads decode the positional dedup row back into a step */
    it("decodes the dedup query's positional row into a DspyStepData", async () => {
      const { repo, query } = setup(null);
      query.mockResolvedValue({
        rows: [
          [
            "project-1/run-1/0",
            "project-1",
            "exp-1",
            "run-1",
            "0",
            null,
            0.75,
            "score",
            "foo",
            "{}",
            "[]",
            "[]",
            "[]",
            0,
            "0",
            0,
            "1970-01-01 00:00:01.000",
            "1970-01-01 00:00:01.100",
            "1970-01-01 00:00:02.000",
            45,
          ],
        ],
        header: {
          names: COLUMN_NAMES,
          types: [
            "String",
            "String",
            "String",
            "String",
            "String",
            "Nullable(String)",
            "Float64",
            "String",
            "String",
            "String",
            "String",
            "String",
            "String",
            "UInt32",
            "UInt64",
            "Float64",
            "DateTime64(3)",
            "DateTime64(3)",
            "DateTime64(3)",
            "UInt16",
          ],
        },
      });

      const result = await repo.getStep("project-1", "exp-1", "run-1", "0");

      expect(result).toEqual({
        tenantId: "project-1",
        experimentId: "exp-1",
        runId: "run-1",
        stepIndex: "0",
        workflowVersionId: null,
        score: 0.75,
        label: "score",
        optimizerName: "foo",
        optimizerParameters: {},
        predictors: [],
        examples: [],
        llmCalls: [],
        createdAt: 1000,
        insertedAt: 1100,
        updatedAt: 2000,
      });
      const call = query.mock.calls[0]![0];
      expect(call.params.tenantId).toBe("project-1");
      expect(call.sql).toContain("TenantId");
    });

    it("returns null when the dedup query finds no row", async () => {
      const { repo } = setup(null);

      const result = await repo.getStep("project-1", "exp-1", "run-1", "0");

      expect(result).toBeNull();
    });
  });

  describe("deleteByExperiment", () => {
    it("throws when no legacy client resolver is wired", async () => {
      const { repo } = setup(null);

      await expect(
        repo.deleteByExperiment("project-1", "exp-1"),
      ).rejects.toThrow(/legacy client resolver/);
    });

    /** @scenario DELETE mutations stay on the legacy client (ADR-104 gap) */
    it("issues the DELETE through the legacy client when wired", async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const legacyResolveClient = vi.fn().mockResolvedValue({ command });
      const insert = vi.fn().mockResolvedValue(undefined);
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const resolveClient = vi
        .fn()
        .mockReturnValue({ insert, query } as unknown as ClickHouseClient);
      const repo = new DspyStepClickHouseRepository(
        resolveClient,
        null,
        legacyResolveClient,
      );

      await repo.deleteByExperiment("project-1", "exp-1");

      expect(legacyResolveClient).toHaveBeenCalledWith("project-1");
      expect(command).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: { tenantId: "project-1", experimentId: "exp-1" },
        }),
      );
    });
  });
});
