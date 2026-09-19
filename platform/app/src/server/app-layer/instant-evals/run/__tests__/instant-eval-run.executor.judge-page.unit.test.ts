/**
 * Judging one page: the judgements it writes, the cursor it reports, what it
 * does with a page it could not judge, and what a cancelled run does.
 *
 * The classifier is the shipped null one, which skips every text: that is the
 * deployment a self-hosted install without a key gets, and a page of skips must
 * still be a recorded page rather than a failure the queue redelivers forever.
 *
 * @see ../instant-eval-run.executor.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import { fakes, PROJECT_ID, RUN_ID } from "./instantEvalRunExecutorFakes";

describe("given a page of a run", () => {
  describe("when it is judged", () => {
    /** @scenario "One judgement row is written per trace and question" */
    it("writes one judgement per trace and question", async () => {
      const { executor, inserted } = fakes();

      await executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        afterSpanId: null,
        pageSize: 500,
        remaining: 1_000,
        keyColumns: ["ThreadId"],
        deadlineAt: null,
      });

      expect(inserted[0]).toHaveLength(2);
      expect(inserted[0]?.map((record) => record.TraceId)).toEqual([
        "t1",
        "t2",
      ]);
    });

    it("reports the cursor the page ended on", async () => {
      const { executor } = fakes();

      const outcome = await executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        afterSpanId: null,
        pageSize: 500,
        remaining: 1_000,
        keyColumns: [],
        deadlineAt: null,
      });

      expect(outcome.cursor).toBe("t2");
    });

    it("says there is more only when the keys say so and rows remain", async () => {
      const withMore = fakes({ hasMore: [true] });
      const exhausted = fakes({ hasMore: [true] });

      const more = await withMore.executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        afterSpanId: null,
        pageSize: 500,
        remaining: 1_000,
        keyColumns: [],
        deadlineAt: null,
      });
      const last = await exhausted.executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        afterSpanId: null,
        pageSize: 500,
        remaining: 2,
        keyColumns: [],
        deadlineAt: null,
      });

      expect(more.hasNextPage).toBe(true);
      expect(last.hasNextPage).toBe(false);
    });

    it("carries what the judging spent", async () => {
      const { executor } = fakes();

      const outcome = await executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        afterSpanId: null,
        pageSize: 500,
        remaining: 1_000,
        keyColumns: [],
        deadlineAt: null,
      });

      expect(outcome).toMatchObject({ inputTokens: 1_200, requests: 2 });
    });
  });

  describe("when the deployment has no classifier configured", () => {
    /** @scenario "A page that partly failed is recorded with its failures counted" */
    it("records the page with its skips rather than throwing", async () => {
      const { executor, inserted } = fakes({
        judgedCells: [null, null],
        skipped: { classifier_not_configured: 2 },
      });

      const outcome = await executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 1,
        afterTraceId: null,
        afterSpanId: null,
        pageSize: 500,
        remaining: 1_000,
        keyColumns: [],
        deadlineAt: null,
      });

      expect(outcome).toMatchObject({ rows: 2, skipped: 2, failed: 0 });
      expect(inserted[0]?.every((record) => record.Status === "skipped")).toBe(
        true,
      );
    });
  });

  describe("when most of the page could not be judged", () => {
    /** @scenario "A page that mostly failed is thrown so the queue delivers it again" */
    it("throws before writing anything", async () => {
      const { executor, inserted } = fakes({
        judgedCells: [null, null],
        skipped: { classifier_failed: 2 },
      });

      await expect(
        executor.judgePage({
          runId: RUN_ID,
          projectId: PROJECT_ID,
          page: 3,
          afterTraceId: "t0",
          afterSpanId: null,
          pageSize: 500,
          remaining: 1_000,
          keyColumns: [],
          deadlineAt: null,
        }),
      ).rejects.toThrow(/page 3/);
      expect(inserted).toEqual([]);
    });
  });

  describe("when the run has been asked to stop", () => {
    /** @scenario "A cancelled run stops between pages" */
    it("judges nothing and reports an empty page", async () => {
      const { executor, rowSource } = fakes({ isCancelled: true });

      const outcome = await executor.judgePage({
        runId: RUN_ID,
        projectId: PROJECT_ID,
        page: 2,
        afterTraceId: "t500",
        afterSpanId: null,
        pageSize: 500,
        remaining: 500,
        keyColumns: [],
        deadlineAt: null,
      });

      expect(rowSource.read).not.toHaveBeenCalled();
      expect(rowSource.judgePrepared).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ rows: 0, hasNextPage: false });
    });
  });
});
