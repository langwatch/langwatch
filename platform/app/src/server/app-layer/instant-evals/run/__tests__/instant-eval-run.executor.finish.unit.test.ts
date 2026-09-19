/**
 * Finishing a run: the one spend record it reports, when it reports none, and
 * what it does when the recorder itself fails.
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
    /** @scenario "A finished run reports its spend once" */
    it("reports one spend record against the run", async () => {
      const { executor, spends } = fakes();

      const spend = await executor.finish({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        outcome: "finished",
        inputTokens: 2_000_000,
        requests: 1_000,
      });

      expect(spends).toHaveLength(1);
      expect(spends[0]).toMatchObject({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        inputTokens: 2_000_000,
        requests: 1_000,
        occurredAt: new Date(NOW),
      });
      expect(spends[0]?.costUsd).toBeCloseTo(0.084, 6);
      expect(spends[0]?.priceUsd).toBeCloseTo(0.1092, 6);
      expect(spend.costUsd).toBeCloseTo(0.084, 6);
      expect(spend.priceUsd).toBeCloseTo(0.1092, 6);
    });
  });

  describe("when its spend has been recorded", () => {
    /** @scenario "A hold is released when the run's spend lands" */
    it("lets go of the run's hold, after the record and on every outcome", async () => {
      const releaseBudget = vi.fn(async () => undefined);
      const { executor, spends } = fakes({ releaseBudget });

      for (const outcome of ["finished", "failed", "cancelled"] as const) {
        await executor.finish({
          runId: RUN_ID,
          projectId: PROJECT_ID,
          outcome,
          inputTokens: 1_000,
          requests: 1,
        });
      }

      expect(releaseBudget).toHaveBeenCalledTimes(3);
      expect(releaseBudget).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        runId: RUN_ID,
      });
      expect(spends).toHaveLength(3);
    });

    it("lets go of the hold of a run that judged nothing", async () => {
      const releaseBudget = vi.fn(async () => undefined);
      const { executor } = fakes({ releaseBudget });

      await executor.finish({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        outcome: "finished",
        inputTokens: 0,
        requests: 0,
      });

      expect(releaseBudget).toHaveBeenCalledTimes(1);
    });
  });

  describe("when it judged nothing", () => {
    /** @scenario "A run that judged nothing reports no spend" */
    it("reports no spend", async () => {
      const { executor, spends } = fakes();

      await executor.finish({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        outcome: "finished",
        inputTokens: 0,
        requests: 0,
      });

      expect(spends).toEqual([]);
    });
  });

  describe("when the spend cannot be recorded", () => {
    /** @scenario "A spend that cannot be recorded is retried, not dropped" */
    it("throws so the outbox retries the finish", async () => {
      const { executor } = fakes();
      const failing = createInstantEvalRunExecutor({
        runs: { create: vi.fn(), list: vi.fn(), findById: vi.fn() } as never,
        judgments: { insert: vi.fn(), page: vi.fn(), sample: vi.fn() },
        rowSource: {} as InstantEvalRowSource,
        classifier: () => new NullInstantEvalClassifier(),
        spendRecorder: {
          recordSpend: async () => {
            throw new Error("spend recorder unavailable");
          },
        },
        projectKey: async () => "lwql-secret",
        maxConcurrency: 4,
        protections: async () => ({}) as never,
        now: () => NOW,
      });
      void executor;

      // Rethrown rather than logged and forgotten: the finish intent is the
      // outbox's, and the record names the run, so a retry lands on the same
      // record instead of billing twice. Swallowing it would leave the run
      // recorded as finished with the spend filed nowhere.
      await expect(
        failing.finish({
          runId: RUN_ID,
          projectId: PROJECT_ID,
          outcome: "finished",
          inputTokens: 1_000,
          requests: 1,
        }),
      ).rejects.toThrow("spend recorder unavailable");
    });
  });
});
