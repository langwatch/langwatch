/**
 * The run's loop: plan, page after page, then finish.
 *
 * Pure state logic, so every case here is one input against one state.
 *
 * @see ../instantEval.process.ts
 * @see ../../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import type { ProcessIntent } from "~/server/event-sourcing/process-manager/processManager.types";
import {
  buildProcessEventView,
  handleCancelRequested,
  handlePageJudged,
  handleRunFinished,
  handleRunPlanned,
  handleRunRequested,
  type InstantEvalIntents,
  instantEvalWake,
} from "../instantEval.process";
import {
  INITIAL_INSTANT_EVAL_STATE,
  INSTANT_EVAL_CANCEL_GRACE_MS,
  INSTANT_EVAL_STALL_THRESHOLD_MS,
  type InstantEvalProcessState,
} from "../instantEvalProcess.types";

const RUN_ID = "instanteval_1";
const NOW = 1_758_000_000_000;

/** A context whose intent factories record what was asked for. */
function context(now = NOW) {
  const emitted: ProcessIntent[] = [];
  const factory =
    (intentType: string) =>
    (key: string, payload: unknown): ProcessIntent => {
      const intent = { messageKey: key, intentType, payload } as ProcessIntent;
      emitted.push(intent);
      return intent;
    };
  return {
    emitted,
    ctx: {
      at: now,
      now,
      key: RUN_ID,
      projectId: "project-1",
      // Keyed by the intent names the process declares, so a renamed intent
      // fails to typecheck here rather than silently recording nothing.
      intents: {
        plan: factory("plan"),
        judgePage: factory("judgePage"),
        finish: factory("finish"),
      } satisfies Record<keyof InstantEvalIntents, unknown>,
    } as unknown as Parameters<typeof handleRunRequested>[2],
  };
}

const running: InstantEvalProcessState = {
  ...INITIAL_INSTANT_EVAL_STATE,
  phase: "running",
  page: 1,
  cursor: "t500",
  pageSize: 500,
  keyColumns: ["ThreadId"],
  remaining: 700,
  inputTokens: 800,
  requests: 500,
  lastActivityAtMs: NOW,
};

const view = (overrides: Record<string, unknown>) => ({
  runId: RUN_ID,
  rowLimit: 10_000,
  questions: 2,
  total: 0,
  pageSize: 0,
  keyColumns: [],
  page: 0,
  rows: 0,
  failed: 0,
  skipped: 0,
  inputTokens: 0,
  requests: 0,
  cursor: null,
  hasNextPage: false,
  ...overrides,
});

describe("given a run nothing has happened to yet", () => {
  describe("when the request lands", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("asks for the plan", () => {
      const { ctx, emitted } = context();

      const evolution = handleRunRequested(
        INITIAL_INSTANT_EVAL_STATE,
        view({}),
        ctx,
      );

      expect(evolution.state.phase).toBe("planning");
      expect(emitted).toEqual([
        {
          messageKey: `plan:${RUN_ID}`,
          intentType: "plan",
          payload: { runId: RUN_ID, projectId: "project-1" },
        },
      ]);
    });

    it("arms the stall wake", () => {
      const { ctx } = context();

      const evolution = handleRunRequested(
        INITIAL_INSTANT_EVAL_STATE,
        view({}),
        ctx,
      );

      expect(evolution.nextWakeAt).toBe(NOW + INSTANT_EVAL_STALL_THRESHOLD_MS);
    });
  });

  describe("when the request is delivered a second time", () => {
    it("does not plan the run again", () => {
      const { ctx, emitted } = context();

      handleRunRequested({ ...running }, view({}), ctx);

      expect(emitted).toEqual([]);
    });
  });
});

describe("given a planned run", () => {
  describe("when it matched rows", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("judges the first page from the start of the selection", () => {
      const { ctx, emitted } = context();

      const evolution = handleRunPlanned(
        { ...INITIAL_INSTANT_EVAL_STATE, phase: "planning" },
        view({ total: 1_200, pageSize: 500, keyColumns: ["ThreadId"] }),
        ctx,
      );

      expect(evolution.state).toMatchObject({
        phase: "running",
        remaining: 1_200,
        pageSize: 500,
      });
      expect(emitted[0]).toMatchObject({
        messageKey: `page:${RUN_ID}:1`,
        payload: {
          page: 1,
          afterTraceId: null,
          pageSize: 500,
          remaining: 1_200,
          keyColumns: ["ThreadId"],
        },
      });
    });
  });

  describe("when it matched nothing", () => {
    it("finishes rather than failing, because the question was answered", () => {
      const { ctx, emitted } = context();

      const evolution = handleRunPlanned(
        { ...INITIAL_INSTANT_EVAL_STATE, phase: "planning" },
        view({ total: 0, pageSize: 500 }),
        ctx,
      );

      expect(evolution.state.phase).toBe("terminal");
      expect(emitted[0]).toMatchObject({
        intentType: "finish",
        payload: { outcome: "finished", errorCode: null },
      });
    });
  });

  describe("when it was cancelled while it was still planning", () => {
    it("finishes as cancelled without judging a page", () => {
      const { ctx, emitted } = context();

      const evolution = handleRunPlanned(
        {
          ...INITIAL_INSTANT_EVAL_STATE,
          phase: "cancelling",
          cancelRequestedAtMs: NOW,
        },
        view({ total: 1_200, pageSize: 500 }),
        ctx,
      );

      expect(evolution.state.phase).toBe("terminal");
      expect(emitted.map((intent) => intent.intentType)).toEqual(["finish"]);
    });
  });
});

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

describe("given an event the process is about to be given", () => {
  describe("when its payload view is built", () => {
    /** @scenario "A judged page reports ids and counts, never text" */
    it("carries ids and counts and nothing else", () => {
      const payload = buildProcessEventView({
        aggregateId: RUN_ID,
        data: {
          runId: RUN_ID,
          page: 2,
          rows: 500,
          matchedByQuestion: { annoyed: 12 },
          failed: 1,
          skipped: 2,
          inputTokens: 900,
          requests: 500,
          cursor: "t1000",
          hasNextPage: true,
        },
      } as never);

      expect(payload).toMatchObject({
        runId: RUN_ID,
        page: 2,
        rows: 500,
        failed: 1,
        skipped: 2,
        inputTokens: 900,
        requests: 500,
        cursor: "t1000",
        hasNextPage: true,
      });
    });

    /** @scenario "A judged page reports ids and counts, never text" */
    it("drops the statement a request carried", () => {
      const payload = buildProcessEventView({
        aggregateId: RUN_ID,
        data: {
          runId: RUN_ID,
          name: "annoyed customers",
          sql: "SELECT TraceId, eval(conversation(ConversationId), 'x') AS y FROM analytics.traces",
          parameters: { customer: "acme" },
          questions: [{ id: "y", kind: "boolean" }],
          rowLimit: 10_000,
        },
      } as never);

      expect(JSON.stringify(payload)).not.toContain("SELECT");
      expect(JSON.stringify(payload)).not.toContain("acme");
      expect(payload).toMatchObject({ rowLimit: 10_000, questions: 1 });
    });
  });
});
