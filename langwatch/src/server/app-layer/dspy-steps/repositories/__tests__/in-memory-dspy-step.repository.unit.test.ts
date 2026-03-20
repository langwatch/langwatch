import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryDspyStepRepository } from "../dspy-step.repository";
import type { DspyStepData } from "../../types";

function makeStep(overrides: Partial<DspyStepData> = {}): DspyStepData {
  return {
    tenantId: "tenant-1",
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

describe("given InMemoryDspyStepRepository", () => {
  let repo: InMemoryDspyStepRepository;

  beforeEach(() => {
    repo = new InMemoryDspyStepRepository();
  });

  describe("when upserting a new step", () => {
    test("stores and retrieves the step", async () => {
      const step = makeStep();
      await repo.upsertStep(step);

      const result = await repo.getStep("tenant-1", "exp-1", "run-1", "0");
      expect(result).toEqual(step);
    });
  });

  describe("when upserting an existing step", () => {
    test("merges examples by hash without duplication", async () => {
      await repo.upsertStep(
        makeStep({
          examples: [
            { hash: "aaa", example: { a: 1 }, pred: { b: 1 }, score: 0.5 },
          ],
        }),
      );

      await repo.upsertStep(
        makeStep({
          examples: [
            { hash: "aaa", example: { a: 1 }, pred: { b: 1 }, score: 0.5 },
            { hash: "bbb", example: { a: 2 }, pred: { b: 2 }, score: 0.6 },
          ],
          updatedAt: 2000,
        }),
      );

      const result = await repo.getStep("tenant-1", "exp-1", "run-1", "0");
      expect(result!.examples).toHaveLength(2);
      expect(result!.examples.map((e) => e.hash)).toEqual(["aaa", "bbb"]);
    });

    test("merges llmCalls by hash without duplication", async () => {
      await repo.upsertStep(
        makeStep({
          llmCalls: [
            { hash: "c1", __class__: "GPT3", response: {}, model: "gpt-4o" },
          ],
        }),
      );

      await repo.upsertStep(
        makeStep({
          llmCalls: [
            { hash: "c1", __class__: "GPT3", response: {}, model: "gpt-4o" },
            { hash: "c2", __class__: "GPT3", response: {}, model: "gpt-4o" },
          ],
          updatedAt: 2000,
        }),
      );

      const result = await repo.getStep("tenant-1", "exp-1", "run-1", "0");
      expect(result!.llmCalls).toHaveLength(2);
      expect(result!.llmCalls.map((c) => c.hash)).toEqual(["c1", "c2"]);
    });

    test("updates score but preserves original createdAt and insertedAt", async () => {
      await repo.upsertStep(
        makeStep({ score: 0.5, createdAt: 1000, insertedAt: 1000 }),
      );
      await repo.upsertStep(
        makeStep({
          score: 0.8,
          createdAt: 2000,
          insertedAt: 2000,
          updatedAt: 2000,
        }),
      );

      const result = await repo.getStep("tenant-1", "exp-1", "run-1", "0");
      expect(result!.score).toBe(0.8);
      expect(result!.createdAt).toBe(1000);
      expect(result!.insertedAt).toBe(1000);
      expect(result!.updatedAt).toBe(2000);
    });
  });

  describe("when getting steps by experiment", () => {
    test("returns only steps matching tenantId and experimentId", async () => {
      await repo.upsertStep(
        makeStep({ tenantId: "t1", experimentId: "e1", runId: "r1" }),
      );
      await repo.upsertStep(
        makeStep({ tenantId: "t1", experimentId: "e2", runId: "r2" }),
      );
      await repo.upsertStep(
        makeStep({ tenantId: "t2", experimentId: "e1", runId: "r3" }),
      );

      const results = await repo.getStepsByExperiment("t1", "e1");
      expect(results).toHaveLength(1);
      expect(results[0]!.runId).toBe("r1");
    });

    test("computes LLM summary from llmCalls", async () => {
      await repo.upsertStep(
        makeStep({
          llmCalls: [
            {
              hash: "c1",
              __class__: "GPT3",
              response: {},
              prompt_tokens: 100,
              completion_tokens: 50,
              cost: 0.01,
            },
            {
              hash: "c2",
              __class__: "GPT3",
              response: {},
              prompt_tokens: 200,
              completion_tokens: 100,
              cost: 0.02,
            },
          ],
        }),
      );

      const results = await repo.getStepsByExperiment("tenant-1", "exp-1");
      expect(results[0]!.llmCallsTotal).toBe(2);
      expect(results[0]!.llmCallsTotalTokens).toBe(450);
      expect(results[0]!.llmCallsTotalCost).toBeCloseTo(0.03);
    });
  });

  describe("when deleting by experiment", () => {
    test("removes only steps matching tenantId and experimentId", async () => {
      await repo.upsertStep(
        makeStep({ tenantId: "t1", experimentId: "e1", runId: "r1" }),
      );
      await repo.upsertStep(
        makeStep({ tenantId: "t1", experimentId: "e2", runId: "r2" }),
      );

      await repo.deleteByExperiment("t1", "e1");

      expect(await repo.getStep("t1", "e1", "r1", "0")).toBeNull();
      expect(await repo.getStep("t1", "e2", "r2", "0")).not.toBeNull();
    });
  });

  describe("when clearing", () => {
    test("removes all steps", async () => {
      await repo.upsertStep(makeStep({ runId: "r1" }));
      await repo.upsertStep(makeStep({ runId: "r2" }));

      repo.clear();

      expect(await repo.getStepsByExperiment("tenant-1", "exp-1")).toEqual([]);
    });
  });
});
