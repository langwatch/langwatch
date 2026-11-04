/**
 * The rest of the loop: page after page, a cancellation, the stall wake, and
 * the outcome that clears the wake for good. Pure state logic, so every case
 * here is one input against one state.
 * @see modules/instant-eval/specs/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import {
  INITIAL_INSTANT_EVAL_STATE,
  INSTANT_EVAL_CANCEL_GRACE_MS,
  INSTANT_EVAL_LATE_PAGE_HOLD_MS,
  INSTANT_EVAL_STALL_THRESHOLD_MS,
} from "../instant-eval-processing-data.process.ts";
import {
  handleInstantEvalCancelRequested,
  handleInstantEvalFinished,
  handleInstantEvalPageJudged,
  instantEvalWake,
} from "../instant-eval-processing-evolution.process.ts";
import { context, NOW, RUN_ID, running, view } from "./instant-eval-process.fixtures.ts";

describe("given a run judging its pages", () => {
  describe("when a page reports more to do", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("judges the next page from the cursor the last one ended on", () => {
      const { ctx, emitted } = context();

      const evolution = handleInstantEvalPageJudged(
        running,
        view({ page: 2, rows: 500, cursor: "t1000", hasNextPage: true }),
        ctx,
      );

      expect(evolution.state).toMatchObject({ page: 2, cursor: "t1000", remaining: 200 });
      expect(emitted[0]).toMatchObject({
        messageKey: `page:${RUN_ID}:3`,
        payload: { page: 3, afterTraceId: "t1000", remaining: 200 },
      });
    });

    it("bounds the last page to what the run may still judge", () => {
      const { ctx, emitted } = context();

      handleInstantEvalPageJudged(
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

      const evolution = handleInstantEvalPageJudged(
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

      handleInstantEvalPageJudged(
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

      const evolution = handleInstantEvalPageJudged(
        running,
        view({ page: 1, rows: 500, cursor: "t500", hasNextPage: true }),
        ctx,
      );

      expect(evolution.state).toEqual(running);
      expect(emitted).toEqual([]);
    });
  });

  describe("when a page older than the one it counted arrives", () => {
    /** @scenario "A page that arrives after a later one does not rewind the run" */
    it("leaves the cursor and the counters where the later page left them", () => {
      const { ctx, emitted } = context();
      const atThirdPage = { ...running, page: 3, cursor: "t1500", remaining: 200 };

      const evolution = handleInstantEvalPageJudged(
        atThirdPage,
        view({ page: 2, rows: 500, cursor: "t1000", hasNextPage: true }),
        ctx,
      );

      expect(evolution.state).toEqual(atThirdPage);
      expect(emitted).toEqual([]);
    });
  });

  describe("when the run reports its spend", () => {
    it("sums the tokens and the requests its pages reported", () => {
      const { ctx } = context();

      const evolution = handleInstantEvalPageJudged(
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

      expect(evolution.state).toMatchObject({ inputTokens: 2_000, requests: 1_000 });
    });

    /** @scenario "A routed judgement is priced from the summed cost of every call" */
    it("sums the routed tokens beside the routed cost and hands both to the finish", () => {
      const { ctx, emitted } = context();
      const routedSoFar = { ...running, costNanoUsd: 300, routedInputTokens: 400 };

      const evolution = handleInstantEvalPageJudged(
        routedSoFar,
        view({
          page: 2,
          rows: 500,
          inputTokens: 1_200,
          costNanoUsd: 0,
          routedInputTokens: 1_200,
          cursor: "t1000",
          hasNextPage: false,
        }),
        ctx,
      );

      expect(evolution.state).toMatchObject({ costNanoUsd: 300, routedInputTokens: 1_600 });
      expect(emitted[0]).toMatchObject({
        payload: { inputTokens: 2_000, costNanoUsd: 300, routedInputTokens: 1_600 },
      });
    });
  });
});

describe("given a run somebody asked to stop", () => {
  describe("when the cancellation lands", () => {
    /** @scenario "A cancelled run stops between pages" */
    it("moves to cancelling without asking for anything", () => {
      const { ctx, emitted } = context();

      const evolution = handleInstantEvalCancelRequested(running, view(), ctx);

      expect(evolution.state).toMatchObject({ phase: "cancelling", cancelRequestedAtMs: NOW });
      expect(emitted).toEqual([]);
      expect(evolution.nextWakeAt).toBe(NOW + INSTANT_EVAL_CANCEL_GRACE_MS);
    });
  });

  describe("when the page it held reports back", () => {
    /** @scenario "A cancelled run stops between pages" */
    it("does not judge the next page and finishes as cancelled", () => {
      const { ctx, emitted } = context();

      const evolution = handleInstantEvalPageJudged(
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
      const { ctx, emitted } = context(NOW + INSTANT_EVAL_STALL_THRESHOLD_MS + 1);

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

      expect(instantEvalWake(INITIAL_INSTANT_EVAL_STATE, ctx).nextWakeAt).toBeNull();
      expect(instantEvalWake({ ...running, phase: "terminal" }, ctx).nextWakeAt).toBeNull();
    });
  });
});

describe("given a finished run", () => {
  describe("when the outcome lands", () => {
    it("clears the wake for good", () => {
      const evolution = handleInstantEvalFinished(running, view(), context().ctx);

      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.nextWakeAt).toBeNull();
    });
  });
});

describe("given a run that ended while a routed page was still judging", () => {
  const ended = { ...running, phase: "terminal" as const, page: 2 };
  const latePage = view({ page: 3, rows: 4, inputTokens: 0, requests: 4, costNanoUsd: 5000 });
  const spent = { page: 3, inputTokens: 0, requests: 4, costNanoUsd: 5000, routedInputTokens: 0 };
  const billed = { ...spent, runId: RUN_ID, projectId: "project-1" };

  describe("when the page reports before the finish has landed", () => {
    /** @scenario "A routed page that reports after its run finished is billed on its own" */
    it("holds the page's spend, and bills it once the finish lands", () => {
      const { ctx, emitted } = context();

      const held = handleInstantEvalPageJudged(ended, latePage, ctx);
      expect(emitted).toEqual([]);
      expect(held.state).toMatchObject({ page: 3, unbilledLatePages: [spent] });

      const finished = handleInstantEvalFinished(held.state, view(), ctx);
      expect(finished.state).toMatchObject({ isFinishRecorded: true, unbilledLatePages: [] });
      expect(emitted).toEqual([
        { messageKey: `late-page:${RUN_ID}:3`, intentType: "billLatePage", payload: billed },
      ]);
    });
  });

  describe("when the page reports after the finish has landed", () => {
    /** @scenario "A routed page that reports after its run finished is billed on its own" */
    it("bills the page at once, and a redelivery of it changes nothing", () => {
      const { ctx, emitted } = context();
      const recorded = { ...ended, isFinishRecorded: true };

      const first = handleInstantEvalPageJudged(recorded, latePage, ctx);
      const again = handleInstantEvalPageJudged(first.state, latePage, ctx);

      expect(emitted).toEqual([
        { messageKey: `late-page:${RUN_ID}:3`, intentType: "billLatePage", payload: billed },
      ]);
      expect(again.state).toEqual(first.state);
      expect(first.nextWakeAt).toBeNull();
    });
  });

  describe("when the page is held and the run's finish never lands", () => {
    /** @scenario "A held late page is billed even when its run's finish never lands" */
    it("wakes when the hold runs out and bills the page without the finish, once", () => {
      const { ctx, emitted } = context();
      const held = handleInstantEvalPageJudged(ended, latePage, ctx);
      expect(held.nextWakeAt).toBe(NOW + INSTANT_EVAL_LATE_PAGE_HOLD_MS);

      const early = instantEvalWake(held.state, context(NOW + 1_000).ctx);
      expect(early).toMatchObject({ nextWakeAt: NOW + INSTANT_EVAL_LATE_PAGE_HOLD_MS });

      const late = context(NOW + INSTANT_EVAL_LATE_PAGE_HOLD_MS);
      const flushed = instantEvalWake(held.state, late.ctx);
      expect(late.emitted).toEqual([
        {
          messageKey: `late-page:${RUN_ID}:3`,
          intentType: "billLatePage",
          payload: { ...billed, isFinishMissing: true },
        },
      ]);
      expect(flushed.state).toMatchObject({ unbilledLatePages: [], lateHoldUntilMs: null });
      expect(flushed.nextWakeAt).toBeNull();

      // A finish that lands after all finds nothing held, so the page is not billed twice.
      const finished = handleInstantEvalFinished(flushed.state, view(), late.ctx);
      expect(late.emitted).toHaveLength(1);
      expect(finished.state).toMatchObject({ isFinishRecorded: true });
      expect(emitted).toEqual([]);
    });

    /** @scenario "A held late page is billed even when its run's finish never lands" */
    it("keeps the hold's wake through a terminal no-op", () => {
      const { ctx } = context();
      const held = handleInstantEvalPageJudged(ended, latePage, ctx);

      const redelivered = handleInstantEvalPageJudged(held.state, latePage, ctx);
      const cancelled = handleInstantEvalCancelRequested(held.state, view(), ctx);

      expect(redelivered.nextWakeAt).toBe(NOW + INSTANT_EVAL_LATE_PAGE_HOLD_MS);
      expect(cancelled.nextWakeAt).toBe(NOW + INSTANT_EVAL_LATE_PAGE_HOLD_MS);
    });
  });

  describe("when the late page carries no routed spend", () => {
    /** @scenario "A routed page that reports after its run finished is billed on its own" */
    it("changes nothing and asks for nothing, as before the router", () => {
      const { ctx, emitted } = context();
      const recorded = { ...ended, isFinishRecorded: true };

      const evolution = handleInstantEvalPageJudged(
        recorded,
        view({ page: 3, rows: 4, inputTokens: 900, requests: 4 }),
        ctx,
      );

      expect(evolution.state).toEqual(recorded);
      expect(emitted).toEqual([]);
    });
  });
});
