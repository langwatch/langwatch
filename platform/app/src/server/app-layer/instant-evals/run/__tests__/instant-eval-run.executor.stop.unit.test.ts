/**
 * A page stopped part way: by a cancellation, or by the lease it judges under.
 *
 * @see ../instant-eval-run.judge-page.ts
 * @see ../page-stop.ts
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import { INSTANT_EVAL_CANCEL_POLL_MS } from "../cancellation-watch";
import { INSTANT_EVAL_PAGE_SETTLE_MS } from "../page-stop";
import { fakes, NOW, PROJECT_ID, RUN_ID } from "./instantEvalRunExecutorFakes";

const PAGE = {
  runId: RUN_ID,
  projectId: PROJECT_ID,
  page: 2,
  afterTraceId: "t0",
  afterSpanId: null,
  pageSize: 500,
  remaining: 1_000,
  keyColumns: [],
};

/** A lease with `judgeMs` of judging left once the margins are kept back. */
function leaseLeaving(judgeMs: number): number {
  return (
    NOW + INSTANT_EVAL_PAGE_SETTLE_MS + INSTANT_EVAL_CANCEL_POLL_MS + judgeMs
  );
}

describe("given a page whose judging stops part way", () => {
  describe("when the stop reaches the page after the first row answered", () => {
    /** @scenario "A page stopped part way keeps the judgements it made" */
    it("writes the answered row, reports its tokens, and ends on its key", async () => {
      const { executor, inserted } = fakes({
        stopMidPage: { unjudgedRows: [1] },
      });

      const outcome = await executor.judgePage({ ...PAGE, deadlineAt: null });

      expect(inserted[0]?.map((record) => record.TraceId)).toEqual(["t1"]);
      expect(inserted[0]?.[0]?.Status).toBe("judged");
      expect(outcome).toMatchObject({
        rows: 1,
        inputTokens: 1_200,
        requests: 2,
        cursor: "t1",
      });
    });
  });

  describe("when the stop reached a row before the last judged one", () => {
    /** @scenario "A page stopped part way keeps the judgements it made" */
    it("writes that row as skipped, naming the stop, so the cursor moves past it", async () => {
      const { executor, inserted } = fakes({
        stopMidPage: { unjudgedRows: [0], onSignal: true },
      });

      const outcome = await executor.judgePage({
        ...PAGE,
        deadlineAt: leaseLeaving(20),
      });

      expect(
        inserted[0]?.map((record) => [record.TraceId, record.Status]),
      ).toEqual([
        ["t1", "skipped"],
        ["t2", "judged"],
      ]);
      expect(inserted[0]?.[0]?.Error).toBe("page_deadline");
      expect(outcome).toMatchObject({ rows: 2, skipped: 1, cursor: "t2" });
    });
  });
});

describe("given a page intent leased for a while", () => {
  describe("when the lease runs down while the page is judging", () => {
    /** @scenario "A page judges under a deadline inside its lease" */
    it("stops before the lease lapses and reports where to resume", async () => {
      const { executor, inserted, rowSource } = fakes({
        stopMidPage: { unjudgedRows: [1], onSignal: true },
        hasMore: [false],
      });

      const outcome = await executor.judgePage({
        ...PAGE,
        deadlineAt: leaseLeaving(20),
      });

      expect(rowSource.judgePrepared).toHaveBeenCalledTimes(1);
      expect(inserted[0]?.map((record) => record.TraceId)).toEqual(["t1"]);
      // More is left even though the key pass said this was the last page:
      // the row after the cut was never judged, and the next intent starts
      // from the last judged key rather than from the page's own last one.
      expect(outcome).toMatchObject({
        rows: 1,
        cursor: "t1",
        cursorSpanId: null,
        hasNextPage: true,
      });
    });
  });

  describe("when the deadline lands before any row answered", () => {
    /** @scenario "A page judges under a deadline inside its lease" */
    it("writes nothing and keeps the cursor where the page started", async () => {
      const { executor, inserted } = fakes({
        stopMidPage: { unjudgedRows: [0, 1], onSignal: true },
      });

      const outcome = await executor.judgePage({
        ...PAGE,
        deadlineAt: leaseLeaving(20),
      });

      expect(inserted).toEqual([[]]);
      expect(outcome).toMatchObject({
        rows: 0,
        cursor: "t0",
        cursorSpanId: null,
        hasNextPage: true,
      });
    });
  });

  describe("when the lease has less than the margin left", () => {
    /** @scenario "A page with no lease left is not started" */
    it("throws before reading, so the outbox delivers it again under a fresh lease", async () => {
      const { executor, rowSource } = fakes();

      await expect(
        executor.judgePage({ ...PAGE, deadlineAt: leaseLeaving(0) }),
      ).rejects.toThrow(/no lease left/);
      expect(rowSource.judgePrepared).not.toHaveBeenCalled();
    });
  });
});

describe("given a page a cancellation stops part way", () => {
  describe("when the page is written", () => {
    /** @scenario "A page cancelled part way ends the run where it got to" */
    it("keeps what answered and reports no next page", async () => {
      const { executor, inserted } = fakes({
        stopMidPage: { unjudgedRows: [1] },
      });

      const outcome = await executor.judgePage({ ...PAGE, deadlineAt: null });

      expect(inserted[0]?.map((record) => record.TraceId)).toEqual(["t1"]);
      expect(outcome.hasNextPage).toBe(false);
    });
  });
});
