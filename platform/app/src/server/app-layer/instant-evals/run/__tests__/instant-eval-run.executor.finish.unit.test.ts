/**
 * Finishing a run: the one cost row it writes, when it writes none, and what it
 * does when the write itself fails.
 *
 * @see ../instant-eval-run.executor.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it, vi } from "vitest";

import { NullInstantEvalClassifier } from "../../classifier/null.client";
import { createInstantEvalRunExecutor } from "../instant-eval-run.executor";
import type { InstantEvalRowSource } from "../row-source";
import { fakes, NOW, PROJECT_ID, RUN_ID } from "./instantEvalRunExecutorFakes";

describe("given a run that is finishing", () => {
  describe("when it judged something", () => {
    /** @scenario "A finished run records what it cost in one row" */
    it("records one cost row against the run", async () => {
      const { executor, costs } = fakes();

      const spend = await executor.finish({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        outcome: "finished",
        inputTokens: 2_000_000,
        requests: 1_000,
      });

      expect(costs).toHaveLength(1);
      expect(costs[0]).toMatchObject({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        inputTokens: 2_000_000,
        requests: 1_000,
      });
      expect(spend.costUsd).toBeCloseTo(0.084, 6);
      expect(spend.priceUsd).toBeCloseTo(0.1092, 6);
    });
  });

  describe("when it judged nothing", () => {
    /** @scenario "A run that judged nothing writes no cost row" */
    it("writes no cost row", async () => {
      const { executor, costs } = fakes();

      await executor.finish({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        outcome: "finished",
        inputTokens: 0,
        requests: 0,
      });

      expect(costs).toEqual([]);
    });
  });

  describe("when the cost row cannot be written", () => {
    /** @scenario "A cost that cannot be written is retried, not dropped" */
    it("throws so the outbox retries the finish", async () => {
      const { executor } = fakes();
      const failing = createInstantEvalRunExecutor({
        runs: { create: vi.fn(), list: vi.fn(), findById: vi.fn() } as never,
        judgments: { insert: vi.fn(), page: vi.fn(), sample: vi.fn() },
        rowSource: {} as InstantEvalRowSource,
        classifier: () => new NullInstantEvalClassifier(),
        costRecorder: {
          recordCost: async () => {
            throw new Error("cost table unavailable");
          },
        },
        projectKey: async () => "lwql-secret",
        maxConcurrency: 4,
        protections: async () => ({}) as never,
        now: () => NOW,
      });
      void executor;

      // Rethrown rather than logged and forgotten: the finish intent is the
      // outbox's, and the write is addressed by the run id, so a retry lands
      // on the same row instead of billing twice. Swallowing it would leave
      // the run recorded as finished with the ledger permanently short.
      await expect(
        failing.finish({
          runId: RUN_ID,
          projectId: PROJECT_ID,
          outcome: "finished",
          inputTokens: 1_000,
          requests: 1,
        }),
      ).rejects.toThrow("cost table unavailable");
    });
  });
});
