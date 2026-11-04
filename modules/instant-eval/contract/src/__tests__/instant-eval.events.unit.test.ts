import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_EVENT_TYPES,
  INSTANT_EVAL_EVENT_VERSIONS,
} from "../instant-eval-event.constants.ts";
import {
  instantEvalFinishedEventSchema,
  instantEvalPageJudgedEventSchema,
} from "../instant-eval.events.ts";

const envelope = {
  id: "event-1",
  aggregateId: "run-1",
  aggregateType: "instant_eval_run",
  tenantId: "project-1",
  createdAt: 1,
  occurredAt: 1,
};

describe("instant eval run events written before the router", () => {
  /** @scenario "A page event without a routed cost still reads and prices from tokens" */
  it("reads a 2026-09-18 page event with zero routed cost and no routing", () => {
    const event = instantEvalPageJudgedEventSchema.parse({
      ...envelope,
      type: INSTANT_EVAL_EVENT_TYPES.PAGE_JUDGED,
      version: "2026-09-18",
      data: {
        runId: "run-1",
        page: 1,
        rows: 2,
        matchedByQuestion: {},
        failed: 0,
        skipped: 0,
        inputTokens: 900,
        requests: 2,
        cursor: null,
        hasNextPage: false,
      },
    });
    expect(event.data).toMatchObject({ costNanoUsd: 0, routedInputTokens: 0 });
  });

  it("reads a 2026-09-18 finished event with zero routed cost", () => {
    const event = instantEvalFinishedEventSchema.parse({
      ...envelope,
      type: INSTANT_EVAL_EVENT_TYPES.FINISHED,
      version: "2026-09-18",
      data: {
        runId: "run-1",
        outcome: "finished",
        errorCode: null,
        inputTokens: 900,
        requests: 2,
        costUsd: 0.1,
        priceUsd: 0.13,
      },
    });
    expect(event.data.costNanoUsd).toBe(0);
  });

  /** @scenario "A page event without a routed cost still reads and prices from tokens" */
  it("writes the router's fields under the version a pod not yet rolled still reads", () => {
    expect(INSTANT_EVAL_EVENT_VERSIONS.PAGE_JUDGED).toBe("2026-09-18");
    expect(INSTANT_EVAL_EVENT_VERSIONS.FINISHED).toBe("2026-09-18");
  });

  it("refuses a version it never wrote", () => {
    const parsed = instantEvalFinishedEventSchema.safeParse({
      ...envelope,
      type: INSTANT_EVAL_EVENT_TYPES.FINISHED,
      version: "2020-01-01",
      data: {},
    });
    expect(parsed.success).toBe(false);
  });
});
