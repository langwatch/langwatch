/**
 * What stops a run that is already under way from spending past the free
 * budget.
 *
 * A run records its spend once, when it finishes, so the ledger the admission
 * check reads knows nothing about a run in progress. The page check is what
 * covers that gap: it hands the budget what this run has judged so far, priced
 * the way the finish will price it.
 *
 * @see ../instant-eval-run.executor.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it, vi } from "vitest";

import { fakes, PROJECT_ID, RUN_ID } from "./instantEvalRunExecutorFakes";

const PAGE = {
  runId: RUN_ID,
  projectId: PROJECT_ID,
  page: 1,
  afterTraceId: null,
  afterSpanId: null,
  pageSize: 500,
  remaining: 1_000,
  keyColumns: ["ThreadId"],
};

describe("given a run whose organization is on the free budget", () => {
  describe("when the budget still has room", () => {
    it("judges the page and writes its judgements", async () => {
      const assertWithinBudget = vi.fn(async () => undefined);
      const { executor, inserted } = fakes({ assertWithinBudget });

      await executor.judgePage(PAGE);

      expect(assertWithinBudget).toHaveBeenCalledTimes(1);
      expect(inserted[0]).toHaveLength(2);
    });
  });

  describe("when the run's own judging has already crossed the budget", () => {
    /** @scenario "A run under way stops when its own judging crosses the budget" */
    it("refuses the page rather than judging it", async () => {
      const assertWithinBudget = vi.fn(async () => {
        throw new Error("instant_eval_free_budget_exhausted");
      });
      const { executor, inserted } = fakes({ assertWithinBudget });

      await expect(executor.judgePage(PAGE)).rejects.toThrow(
        "instant_eval_free_budget_exhausted",
      );

      // Refused BEFORE the classifier, which is the whole point: a budget that
      // bounds what was spent has to stop the page rather than bill for it.
      expect(inserted).toHaveLength(0);
    });

    /** @scenario "A run under way stops when its own judging crosses the budget" */
    it("counts the tokens the run has already judged, not only the ledger", async () => {
      const assertWithinBudget = vi.fn(async () => undefined);
      const { executor } = fakes({ tokens: 4_000_000, assertWithinBudget });

      await executor.judgePage(PAGE);

      const [call] = assertWithinBudget.mock.calls as unknown as [
        [{ projectId: string; inFlightUsd: number }],
      ];
      expect(call[0].projectId).toBe(PROJECT_ID);
      expect(call[0].inFlightUsd).toBeGreaterThan(0);
    });
  });

  describe("when a run has judged nothing yet", () => {
    it("reports no spend of its own", async () => {
      const assertWithinBudget = vi.fn(async () => undefined);
      const { executor } = fakes({ tokens: 0, assertWithinBudget });

      await executor.judgePage(PAGE);

      const [call] = assertWithinBudget.mock.calls as unknown as [
        [{ projectId: string; inFlightUsd: number }],
      ];
      expect(call[0].inFlightUsd).toBe(0);
    });
  });
});
