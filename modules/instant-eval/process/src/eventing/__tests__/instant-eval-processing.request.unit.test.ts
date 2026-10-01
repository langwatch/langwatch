/**
 * The start of the loop: what a requested run asks for, what a plan turns into,
 * and what the payload view carries into either. Pure state logic, so every
 * case here is one input against one state.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import {
  instantEvalPageJudgedEventSchema,
  instantEvalRequestedEventSchema,
} from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  INITIAL_INSTANT_EVAL_STATE,
  INSTANT_EVAL_STALL_THRESHOLD_MS,
} from "../instant-eval-processing-data.process.ts";
import {
  buildInstantEvalProcessEventView,
  handleInstantEvalPlanned,
  handleInstantEvalRequested,
} from "../instant-eval-processing-evolution.process.ts";
import {
  context,
  NOW,
  PROJECT_ID,
  RUN_ID,
  running,
  view,
} from "./instant-eval-process.fixtures.ts";

const ENVELOPE = {
  id: "event-1",
  aggregateId: RUN_ID,
  aggregateType: "instant_eval_run",
  tenantId: PROJECT_ID,
  createdAt: NOW,
  occurredAt: NOW,
};

describe("given a run nothing has happened to yet", () => {
  describe("when the request lands", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("asks for the plan", () => {
      const { ctx, emitted } = context();

      const evolution = handleInstantEvalRequested(INITIAL_INSTANT_EVAL_STATE, view(), ctx);

      expect(evolution.state.phase).toBe("planning");
      expect(emitted).toEqual([
        {
          messageKey: `plan:${RUN_ID}`,
          intentType: "plan",
          payload: { runId: RUN_ID, projectId: PROJECT_ID },
        },
      ]);
    });

    it("arms the stall wake", () => {
      const { ctx } = context();

      const evolution = handleInstantEvalRequested(INITIAL_INSTANT_EVAL_STATE, view(), ctx);

      expect(evolution.nextWakeAt).toBe(NOW + INSTANT_EVAL_STALL_THRESHOLD_MS);
    });
  });

  describe("when the request is delivered a second time", () => {
    it("does not plan the run again", () => {
      const { ctx, emitted } = context();

      handleInstantEvalRequested({ ...running }, view(), ctx);

      expect(emitted).toEqual([]);
    });
  });
});

describe("given a planned run", () => {
  describe("when it matched rows", () => {
    /** @scenario "A requested run is planned, judged page by page, and finished" */
    it("judges the first page from the start of the selection", () => {
      const { ctx, emitted } = context();

      const evolution = handleInstantEvalPlanned(
        { ...INITIAL_INSTANT_EVAL_STATE, phase: "planning" },
        view({ total: 1_200, pageSize: 500, keyColumns: ["ThreadId"] }),
        ctx,
      );

      expect(evolution.state).toMatchObject({ phase: "running", remaining: 1_200, pageSize: 500 });
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

      const evolution = handleInstantEvalPlanned(
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

      const evolution = handleInstantEvalPlanned(
        { ...INITIAL_INSTANT_EVAL_STATE, phase: "cancelling", cancelRequestedAtMs: NOW },
        view({ total: 1_200, pageSize: 500 }),
        ctx,
      );

      expect(evolution.state.phase).toBe("terminal");
      expect(emitted.map((intent) => intent.intentType)).toEqual(["finish"]);
    });
  });
});

describe("given an event the process is about to be given", () => {
  describe("when its payload view is built", () => {
    /** @scenario "A judged page reports ids and counts, never text" */
    it("carries ids and counts and nothing else", () => {
      const payload = buildInstantEvalProcessEventView(
        instantEvalPageJudgedEventSchema.parse({
          ...ENVELOPE,
          type: "lw.obs.instant_eval.page_judged",
          version: "2026-09-18",
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
        }),
      );

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
      const payload = buildInstantEvalProcessEventView(
        instantEvalRequestedEventSchema.parse({
          ...ENVELOPE,
          type: "lw.obs.instant_eval.requested",
          version: "2026-09-18",
          data: {
            runId: RUN_ID,
            name: "annoyed customers",
            sql: "SELECT TraceId, eval(conversation(ConversationId), 'x') AS y FROM analytics.traces",
            parameters: { customer: "acme" },
            questions: [{ id: "y", kind: "boolean" }],
            rowLimit: 10_000,
          },
        }),
      );

      expect(JSON.stringify(payload)).not.toContain("SELECT");
      expect(JSON.stringify(payload)).not.toContain("acme");
      expect(payload).toMatchObject({ rowLimit: 10_000, questions: 1 });
    });
  });
});
