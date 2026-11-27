/**
 * A page that failed for good ends its run as a failed finish carrying what the
 * judged pages summed, so the finish bills them once (ADR-174 decision 24).
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import {
  INSTANT_EVAL_AGGREGATE_TYPE,
  INSTANT_EVAL_EVENT_TYPES,
  INSTANT_EVAL_EVENT_VERSIONS,
  instantEvalPageFailedEventSchema,
} from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  INITIAL_INSTANT_EVAL_STATE,
  INSTANT_EVAL_STALL_THRESHOLD_MS,
  type InstantEvalProcessState,
} from "../instant-eval-processing-data.process.ts";
import {
  buildInstantEvalProcessEventView,
  handleInstantEvalPageFailed,
  instantEvalWake,
} from "../instant-eval-processing-evolution.process.ts";
import {
  context,
  NOW,
  PROJECT_ID,
  RUN_ID,
  running,
  view,
} from "./instant-eval-process.fixtures.ts";

/** A routed run whose first two pages were judged and recorded. */
const twoPagesJudged: InstantEvalProcessState = {
  ...running,
  page: 2,
  inputTokens: 1_700,
  requests: 1_000,
  costNanoUsd: 5_000,
  routedInputTokens: 300,
};

const failedFinishOf = (overrides: Record<string, unknown>) => ({
  messageKey: `finish:${RUN_ID}:failed`,
  intentType: "finish",
  payload: {
    runId: RUN_ID,
    projectId: PROJECT_ID,
    outcome: "failed",
    ...overrides,
  },
});

describe("given a run whose first two pages were judged", () => {
  describe("when its third page fails for good", () => {
    /** @scenario "A run whose page fails on its last attempt bills the pages it judged" */
    it("finishes the run as failed with the failure's code and the two pages' summed spend", () => {
      const { ctx, emitted } = context();

      const evolution = handleInstantEvalPageFailed(
        twoPagesJudged,
        view({ page: 3, errorCode: "internal_error" }),
        ctx,
      );

      expect(evolution.state.phase).toBe("terminal");
      expect(evolution.nextWakeAt).toBeNull();
      expect(emitted).toEqual([
        failedFinishOf({
          errorCode: "internal_error",
          inputTokens: 1_700,
          requests: 1_000,
          costNanoUsd: 5_000,
          routedInputTokens: 300,
        }),
      ]);
    });

    /** @scenario "A run whose page fails on its last attempt bills the pages it judged" */
    it("bills a run somebody asked to stop the same way", () => {
      const { ctx, emitted } = context();

      handleInstantEvalPageFailed(
        { ...twoPagesJudged, phase: "cancelling", cancelRequestedAtMs: NOW },
        view({ page: 3, errorCode: "internal_error" }),
        ctx,
      );

      expect(emitted).toEqual([
        failedFinishOf({
          errorCode: "internal_error",
          inputTokens: 1_700,
          requests: 1_000,
          costNanoUsd: 5_000,
          routedInputTokens: 300,
        }),
      ]);
    });
  });

  describe("when the next page is refused by a blocking gateway budget", () => {
    /** @scenario "A run stopped by a budget between pages bills the pages judged before it" */
    it("finishes as failed with the budget's code and bills the pages judged before the stop", () => {
      const { ctx, emitted } = context();

      handleInstantEvalPageFailed(
        twoPagesJudged,
        view({ page: 3, errorCode: "instant_eval_gateway_budget_exceeded" }),
        ctx,
      );

      expect(emitted).toEqual([
        failedFinishOf({
          errorCode: "instant_eval_gateway_budget_exceeded",
          inputTokens: 1_700,
          requests: 1_000,
          costNanoUsd: 5_000,
          routedInputTokens: 300,
        }),
      ]);
    });
  });

  describe("when the page failure cannot be recorded", () => {
    /** @scenario "A run whose page fails on its last attempt bills the pages it judged" */
    it("leaves the stall wake to fail the run with the same summed spend", () => {
      const { ctx, emitted } = context(NOW + INSTANT_EVAL_STALL_THRESHOLD_MS + 1);

      instantEvalWake(twoPagesJudged, ctx);

      expect(emitted[0]).toMatchObject({
        payload: { outcome: "failed", inputTokens: 1_700, costNanoUsd: 5_000 },
      });
    });
  });
});

describe("given a run whose first page fails", () => {
  describe("when the failure lands", () => {
    /** @scenario "A run that judged nothing before it failed costs nothing" */
    it("finishes the run as failed with no tokens and no cost", () => {
      const { ctx, emitted } = context();
      const planned: InstantEvalProcessState = {
        ...INITIAL_INSTANT_EVAL_STATE,
        phase: "running",
        pageSize: 500,
        remaining: 1_200,
        lastActivityAtMs: NOW,
      };

      handleInstantEvalPageFailed(planned, view({ page: 1, errorCode: "internal_error" }), ctx);

      expect(emitted).toEqual([
        failedFinishOf({
          errorCode: "internal_error",
          inputTokens: 0,
          requests: 0,
          costNanoUsd: 0,
          routedInputTokens: 0,
        }),
      ]);
    });
  });
});

describe("given a page failure that reaches the run twice", () => {
  describe("when the second arrives after the run ended", () => {
    /** @scenario "A failure delivered again is still one spend record" */
    it("asks for nothing more, so the run has one failed finish", () => {
      const first = context();
      const ended = handleInstantEvalPageFailed(
        twoPagesJudged,
        view({ page: 3, errorCode: "internal_error" }),
        first.ctx,
      );
      const again = context();

      const evolution = handleInstantEvalPageFailed(
        ended.state,
        view({ page: 3, errorCode: "internal_error" }),
        again.ctx,
      );

      expect(first.emitted).toHaveLength(1);
      expect(again.emitted).toEqual([]);
      expect(evolution.state).toEqual(ended.state);
    });
  });

  describe("when it names a page the run already counted", () => {
    it("leaves the run judging, because a later page is already under way", () => {
      const { ctx, emitted } = context();

      const evolution = handleInstantEvalPageFailed(
        twoPagesJudged,
        view({ page: 2, errorCode: "internal_error" }),
        ctx,
      );

      expect(emitted).toEqual([]);
      expect(evolution.state).toEqual(twoPagesJudged);
    });
  });
});

describe("given a page failure event", () => {
  describe("when the process is handed it", () => {
    it("carries the page and the failure's code, nothing else of the page", () => {
      const event = instantEvalPageFailedEventSchema.parse({
        id: "evt-page-failed",
        aggregateId: RUN_ID,
        aggregateType: INSTANT_EVAL_AGGREGATE_TYPE,
        tenantId: PROJECT_ID,
        createdAt: NOW,
        occurredAt: NOW,
        type: INSTANT_EVAL_EVENT_TYPES.PAGE_FAILED,
        version: INSTANT_EVAL_EVENT_VERSIONS.PAGE_FAILED,
        data: { runId: RUN_ID, page: 3, errorCode: "internal_error" },
      });

      expect(buildInstantEvalProcessEventView(event)).toMatchObject({
        runId: RUN_ID,
        page: 3,
        errorCode: "internal_error",
        inputTokens: 0,
      });
    });
  });
});
