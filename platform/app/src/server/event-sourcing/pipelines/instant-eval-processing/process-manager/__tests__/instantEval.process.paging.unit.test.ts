/**
 * The rest of the loop: page after page, a cancellation, the stall wake, and
 * the outcome that clears the wake for good.
 *
 * Pure state logic, so every case here is one input against one state.
 *
 * @see ../instantEval.process.ts
 * @see ../../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import {
  handleCancelRequested,
  handlePageJudged,
  handleRunFinished,
  instantEvalWake,
} from "../instantEval.process";
import {
  INITIAL_INSTANT_EVAL_STATE,
  INSTANT_EVAL_CANCEL_GRACE_MS,
  INSTANT_EVAL_STALL_THRESHOLD_MS,
} from "../instantEvalProcess.types";
import {
  context,
  NOW,
  RUN_ID,
  running,
  view,
} from "./instantEvalProcessFixtures";

describe("given a run judging its pages", () => {
  describe("when a page reports more to do", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("judges the next page from the cursor the last one ended on", () => {
      const { ctx, emitted } = context();

      const evolution = handlePageJudged(
        running,
        view({ page: 2, rows: 500, cursor: "t1000", hasNextPage: true }),
        ctx,
      );

      expect(evolution.state).toMatchObject({
        page: 2,
        cursor: "t1000",
        remaining: 200,
      });
      expect(emitted[0]).toMatchObject({
        messageKey: `page:${RUN_ID}:3`,
        payload: { page: 3, afterTraceId: "t1000", remaining: 200 },
      });
    });

    it("bounds the last page to what the run may still judge", () => {
      const { ctx, emitted } = context();

      handlePageJudged(
        { ...running, remaining: 600 },
        view({ page: 2, rows: 500, cursor: "t1000", hasNextPage: true }),
        ctx,
      );

      expect(emitted[0]).toMatchObject({ payload: { pageSize: 100 } });
    });
  });

  describe("when a page reports nothing more to do", () => {
    it("finishes the run", () => {
      const { ctx, emitted } = context();

      const evolution = handlePageJudged(
        running,
        view({ page: 2, rows: 500, cursor: "t1000", hasNextPage: false }),
        ctx,
      );

      expect(evolution.state.phase).toBe("terminal");
      expect(emitted[0]).toMatchObject({
        messageKey: `finish:${RUN_ID}:done`,
        payload: { outcome: "finished", inputTokens: 800, requests: 500 },
      });
    });

    it("finishes when the run has spent its rows even if more matched", () => {
      const { ctx, emitted } = context();

      handlePageJudged(
        { ...running, remaining: 500 },
        view({ page: 2, rows: 500, cursor: "t1000", hasNextPage: true }),
        ctx,
      );

      expect(emitted[0]).toMatchObject({ intentType: "finish" });
    });
  });

  describe("when a page the run already counted arrives again", () => {
    /** @scenario "A redelivered page writes the same judgements rather than doubling them" */
    it("changes nothing and asks for nothing", () => {
      const { ctx, emitted } = context();

      const evolution = handlePageJudged(
        running,
        view({ page: 1, rows: 500, cursor: "t500", hasNextPage: true }),
        ctx,
      );

      expect(evolution.state).toEqual(running);
      expect(emitted).toEqual([]);
    });
  });

  describe("when the run reports its spend", () => {
    it("sums the tokens and the requests its pages reported", () => {
      const { ctx } = context();

      const evolution = handlePageJudged(
        running,
        view({
          page: 2,
          rows: 500,
          inputTokens: 1_200,
          requests: 500,
          cursor: "t1000",
          hasNextPage: true,
        }),
        ctx,
      );

      expect(evolution.state).toMatchObject({
        inputTokens: 2_000,
        requests: 1_000,
      });
    });
  });
});

describe("given a run somebody asked to stop", () => {
  describe("when the cancellation lands", () => {
    /** @scenario "A cancelled run stops between pages" */
    it("moves to cancelling without asking for anything", () => {
      const { ctx, emitted } = context();

      const evolution = handleCancelRequested(running, view({}), ctx);

      expect(evolution.state).toMatchObject({
        phase: "cancelling",
        cancelRequestedAtMs: NOW,
      });
      expect(emitted).toEqual([]);
      expect(evolution.nextWakeAt).toBe(NOW + INSTANT_EVAL_CANCEL_GRACE_MS);
    });
  });

  describe("when the page it held reports back", () => {
    /** @scenario "A cancelled run stops between pages" */
    it("does not judge the next page and finishes as cancelled", () => {
      const { ctx, emitted } = context();

      const evolution = handlePageJudged(
        { ...running, phase: "cancelling", cancelRequestedAtMs: NOW },
        view({ page: 2, rows: 500, cursor: "t1000", hasNextPage: true }),
        ctx,
      );

      expect(evolution.state.phase).toBe("terminal");
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        messageKey: `finish:${RUN_ID}:cancelled`,
        payload: { outcome: "cancelled" },
      });
    });
  });

  describe("when the page it held never reports back", () => {
    it("keeps waiting inside the grace", () => {
      const { ctx, emitted } = context(NOW + 1_000);

      const evolution = instantEvalWake(
        { ...running, phase: "cancelling", cancelRequestedAtMs: NOW },
        ctx,
      );

      expect(emitted).toEqual([]);
      expect(evolution.nextWakeAt).toBe(NOW + INSTANT_EVAL_CANCEL_GRACE_MS);
    });

    it("forces the run to finish once the grace is up", () => {
      const { ctx, emitted } = context(NOW + INSTANT_EVAL_CANCEL_GRACE_MS + 1);

      const evolution = instantEvalWake(
        { ...running, phase: "cancelling", cancelRequestedAtMs: NOW },
        ctx,
      );

      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.nextWakeAt).toBeNull();
      expect(emitted[0]).toMatchObject({
        messageKey: `finish:${RUN_ID}:cancelled`,
        payload: { outcome: "cancelled" },
      });
    });
  });
});

describe("given a run whose pages stopped arriving", () => {
  describe("when the wake fires inside the stall window", () => {
    it("keeps the wake armed and asks for nothing", () => {
      const { ctx, emitted } = context(NOW + 1_000);

      const evolution = instantEvalWake(running, ctx);

      expect(emitted).toEqual([]);
      expect(evolution.nextWakeAt).toBe(NOW + INSTANT_EVAL_STALL_THRESHOLD_MS);
    });
  });

  describe("when the wake fires past the stall window", () => {
    /** @scenario "A run whose pages stop arriving is failed by the watchdog" */
    it("fails the run with the stalled code", () => {
      const { ctx, emitted } = context(
        NOW + INSTANT_EVAL_STALL_THRESHOLD_MS + 1,
      );

      const evolution = instantEvalWake(running, ctx);

      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.nextWakeAt).toBeNull();
      expect(emitted[0]).toMatchObject({
        messageKey: `finish:${RUN_ID}:stalled`,
        payload: { outcome: "failed", errorCode: "instant_eval_stalled" },
      });
    });
  });

  describe("when the wake fires for a run nothing ever touched", () => {
    it("clears the wake so the worker stops finding it", () => {
      const { ctx } = context();

      expect(
        instantEvalWake(INITIAL_INSTANT_EVAL_STATE, ctx).nextWakeAt,
      ).toBeNull();
      expect(
        instantEvalWake({ ...running, phase: "terminal" }, ctx).nextWakeAt,
      ).toBeNull();
    });
  });
});

describe("given a finished run", () => {
  describe("when the outcome lands", () => {
    it("clears the wake for good", () => {
      const evolution = handleRunFinished(running, view({}), context().ctx);

      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.nextWakeAt).toBeNull();
    });
  });
});
