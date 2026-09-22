/**
 * The run's counters, folded from its own events.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import {
  instantEvalCancelRequestedEventSchema,
  instantEvalFinishedEventSchema,
  instantEvalPageJudgedEventSchema,
  instantEvalPlannedEventSchema,
  instantEvalRequestedEventSchema,
  type InstantEvalProcessingEvent,
} from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  applyInstantEvalRunEvent,
  INITIAL_INSTANT_EVAL_RUN_STATE,
  type InstantEvalRunProjectionState,
} from "../instant-eval-run.projection.ts";

const RUN_ID = "instanteval_1";
const AT = 1_758_000_000_000;

function envelope(type: string, occurredAt: number): Record<string, unknown> {
  return {
    id: `evt-${type}-${occurredAt}`,
    aggregateId: RUN_ID,
    aggregateType: "instant_eval_run",
    tenantId: "project-1",
    createdAt: occurredAt,
    occurredAt,
    version: "2026-09-18",
    type,
  };
}

const requested = (): InstantEvalProcessingEvent =>
  instantEvalRequestedEventSchema.parse({
    ...envelope("lw.obs.instant_eval.requested", AT),
    data: {
      runId: RUN_ID,
      name: null,
      sql: "SELECT TraceId FROM analytics.traces",
      parameters: {},
      questions: [],
      rowLimit: 10_000,
    },
  });

const planned = (total: number): InstantEvalProcessingEvent =>
  instantEvalPlannedEventSchema.parse({
    ...envelope("lw.obs.instant_eval.planned", AT),
    data: { runId: RUN_ID, total, pageSize: 500, isCapped: false, keyColumns: [] },
  });

const page = (overrides: Record<string, unknown>): InstantEvalProcessingEvent =>
  instantEvalPageJudgedEventSchema.parse({
    ...envelope("lw.obs.instant_eval.page_judged", AT),
    data: {
      runId: RUN_ID,
      page: 1,
      rows: 0,
      matched: 0,
      matchedByQuestion: {},
      failed: 0,
      skipped: 0,
      inputTokens: 0,
      requests: 0,
      cursor: null,
      hasNextPage: false,
      ...overrides,
    },
  });

const cancelRequested = (): InstantEvalProcessingEvent =>
  instantEvalCancelRequestedEventSchema.parse({
    ...envelope("lw.obs.instant_eval.cancel_requested", AT),
    data: { runId: RUN_ID, requestedByUserId: null },
  });

const finished = (data: Record<string, unknown>, occurredAt = AT): InstantEvalProcessingEvent =>
  instantEvalFinishedEventSchema.parse({
    ...envelope("lw.obs.instant_eval.finished", occurredAt),
    data: {
      runId: RUN_ID,
      errorCode: null,
      inputTokens: 0,
      requests: 0,
      costUsd: 0,
      priceUsd: 0,
      ...data,
    },
  });

function fold(events: readonly InstantEvalProcessingEvent[]): InstantEvalRunProjectionState {
  return events.reduce(applyInstantEvalRunEvent, INITIAL_INSTANT_EVAL_RUN_STATE);
}

describe("given a run's event stream", () => {
  describe("when only the request has landed", () => {
    it("reports the run as queued with nothing counted", () => {
      expect(fold([requested()])).toMatchObject({
        status: "QUEUED",
        total: null,
        progress: 0,
      });
    });
  });

  describe("when the run has been planned", () => {
    it("reports it running with the total the key pass found", () => {
      expect(fold([requested(), planned(1_200)])).toMatchObject({
        status: "RUNNING",
        total: 1_200,
        startedAtMs: AT,
      });
    });
  });

  describe("when two pages have been judged", () => {
    /** @scenario "The run row is folded from the page events" */
    it("holds the progress, the matches per question, the failures, the skips and the tokens", () => {
      const state = fold([
        planned(1_000),
        page({
          page: 1,
          rows: 500,
          matched: 42,
          matchedByQuestion: { annoyed: 42, intent: 500 },
          failed: 2,
          skipped: 1,
          inputTokens: 800,
          requests: 500,
          cursor: "t500",
          hasNextPage: true,
        }),
        page({
          page: 2,
          rows: 500,
          matched: 8,
          matchedByQuestion: { annoyed: 8, intent: 499 },
          failed: 0,
          skipped: 3,
          inputTokens: 1_200,
          requests: 500,
          cursor: "t1000",
          hasNextPage: false,
        }),
      ]);

      expect(state).toMatchObject({
        progress: 1_000,
        matched: 50,
        matchedByQuestion: { annoyed: 50, intent: 999 },
        failed: 2,
        skipped: 4,
        tokens: 2_000,
      });
    });

    it("sums the tokens its pages reported", () => {
      const state = fold([
        page({ page: 1, rows: 10, inputTokens: 800, hasNextPage: true }),
        page({ page: 2, rows: 10, inputTokens: 1_200 }),
      ]);

      expect(state.tokens).toBe(2_000);
    });
  });

  describe("when a cancellation has been requested", () => {
    it("leaves the status alone until the run actually stops", () => {
      expect(fold([planned(10), cancelRequested()]).status).toBe("RUNNING");
    });
  });

  describe("when the run has finished", () => {
    it("reports the outcome, the spend and when it ended", () => {
      const state = fold([
        page({ page: 1, rows: 10, inputTokens: 500 }),
        finished(
          {
            outcome: "finished",
            inputTokens: 500,
            requests: 10,
            costUsd: 0.000021,
            priceUsd: 0.0000273,
          },
          AT + 5_000,
        ),
      ]);

      expect(state).toMatchObject({
        status: "FINISHED",
        error: null,
        costUsd: 0.000021,
        priceUsd: 0.0000273,
        finishedAtMs: AT + 5_000,
      });
    });

    it("reports a cancelled run as cancelled", () => {
      expect(fold([finished({ outcome: "cancelled" })]).status).toBe("CANCELLED");
    });

    /** @scenario "A run whose pages stop arriving is failed by the watchdog" */
    it("reports a stalled run as failed, carrying the code", () => {
      const state = fold([finished({ outcome: "failed", errorCode: "instant_eval_stalled" })]);

      expect(state).toMatchObject({ status: "FAILED", error: "instant_eval_stalled" });
    });

    it("does not move a finished run back to running on a late page", () => {
      const state = fold([
        finished({ outcome: "cancelled" }),
        page({ page: 9, rows: 10, inputTokens: 100 }),
      ]);

      expect(state).toMatchObject({ status: "CANCELLED", progress: 10 });
    });
  });

  describe("when the same stream is folded twice", () => {
    it("produces the same row, because nothing here reads a clock", () => {
      const events = [
        requested(),
        planned(10),
        page({ page: 1, rows: 10, matched: 3, inputTokens: 200 }),
      ];

      expect(fold(events)).toEqual(fold(events));
    });
  });
});
