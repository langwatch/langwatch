/**
 * The run's counters, folded from its own events.
 *
 * @see ../instantEvalRun.stateProjection.ts
 * @see ../../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";
import { INSTANT_EVAL_EVENT_TYPES } from "../../schemas/constants";
import type { InstantEvalProcessingEvent } from "../../schemas/events";
import {
  applyInstantEvalRunEvent,
  INITIAL_INSTANT_EVAL_RUN_STATE,
} from "../instantEvalRun.stateProjection";

const RUN_ID = "instanteval_1";
const AT = 1_758_000_000_000;

function event(
  type: InstantEvalProcessingEvent["type"],
  data: Record<string, unknown>,
  occurredAt = AT,
): InstantEvalProcessingEvent {
  return {
    id: `evt-${type}-${occurredAt}`,
    aggregateId: RUN_ID,
    aggregateType: "instant_eval_run",
    tenantId: "project-1",
    createdAt: occurredAt,
    occurredAt,
    version: "2026-09-18",
    type,
    data,
  } as InstantEvalProcessingEvent;
}

const page = (overrides: Record<string, unknown>) =>
  event(INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED, {
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
  });

function fold(events: readonly InstantEvalProcessingEvent[]) {
  return events.reduce(
    applyInstantEvalRunEvent,
    INITIAL_INSTANT_EVAL_RUN_STATE,
  );
}

describe("given a run's event stream", () => {
  describe("when only the request has landed", () => {
    it("reports the run as queued with nothing counted", () => {
      const state = fold([
        event(INSTANT_EVAL_EVENT_TYPES.REQUESTED, { runId: RUN_ID }),
      ]);

      expect(state).toMatchObject({
        status: "QUEUED",
        total: null,
        progress: 0,
      });
    });
  });

  describe("when the run has been planned", () => {
    it("reports it running with the total the key pass found", () => {
      const state = fold([
        event(INSTANT_EVAL_EVENT_TYPES.REQUESTED, { runId: RUN_ID }),
        event(INSTANT_EVAL_EVENT_TYPES.PLANNED, {
          runId: RUN_ID,
          total: 1_200,
          pageSize: 500,
          isCapped: false,
          keyColumns: [],
        }),
      ]);

      expect(state).toMatchObject({
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
        event(INSTANT_EVAL_EVENT_TYPES.PLANNED, {
          runId: RUN_ID,
          total: 1_000,
          pageSize: 500,
          isCapped: false,
          keyColumns: [],
        }),
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

    /** @scenario "A run's tokens are the sum of what its pages reported" */
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
      const state = fold([
        event(INSTANT_EVAL_EVENT_TYPES.PLANNED, {
          runId: RUN_ID,
          total: 10,
          pageSize: 10,
          isCapped: false,
          keyColumns: [],
        }),
        event(INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED, {
          runId: RUN_ID,
          requestedByUserId: null,
        }),
      ]);

      expect(state.status).toBe("RUNNING");
    });
  });

  describe("when the run has finished", () => {
    /** @scenario "The cost and the price stay on the run's row" */
    it("reports the outcome, the spend and when it ended", () => {
      const state = fold([
        page({ page: 1, rows: 10, inputTokens: 500 }),
        event(
          INSTANT_EVAL_EVENT_TYPES.FINISHED,
          {
            runId: RUN_ID,
            outcome: "finished",
            errorCode: null,
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
      const state = fold([
        event(INSTANT_EVAL_EVENT_TYPES.FINISHED, {
          runId: RUN_ID,
          outcome: "cancelled",
          errorCode: null,
          inputTokens: 0,
          requests: 0,
          costUsd: 0,
          priceUsd: 0,
        }),
      ]);

      expect(state.status).toBe("CANCELLED");
    });

    /** @scenario "A run whose pages stop arriving is failed by the watchdog" */
    it("reports a stalled run as failed, carrying the code", () => {
      const state = fold([
        event(INSTANT_EVAL_EVENT_TYPES.FINISHED, {
          runId: RUN_ID,
          outcome: "failed",
          errorCode: "instant_eval_stalled",
          inputTokens: 0,
          requests: 0,
          costUsd: 0,
          priceUsd: 0,
        }),
      ]);

      expect(state).toMatchObject({
        status: "FAILED",
        error: "instant_eval_stalled",
      });
    });

    it("does not move a finished run back to running on a late page", () => {
      const state = fold([
        event(INSTANT_EVAL_EVENT_TYPES.FINISHED, {
          runId: RUN_ID,
          outcome: "cancelled",
          errorCode: null,
          inputTokens: 0,
          requests: 0,
          costUsd: 0,
          priceUsd: 0,
        }),
        page({ page: 9, rows: 10, inputTokens: 100 }),
      ]);

      expect(state).toMatchObject({ status: "CANCELLED", progress: 10 });
    });
  });

  describe("when the same stream is folded twice", () => {
    it("produces the same row, because nothing here reads a clock", () => {
      const events = [
        event(INSTANT_EVAL_EVENT_TYPES.REQUESTED, { runId: RUN_ID }),
        event(INSTANT_EVAL_EVENT_TYPES.PLANNED, {
          runId: RUN_ID,
          total: 10,
          pageSize: 10,
          isCapped: false,
          keyColumns: [],
        }),
        page({ page: 1, rows: 10, matched: 3, inputTokens: 200 }),
      ];

      expect(fold(events)).toEqual(fold(events));
    });
  });
});
