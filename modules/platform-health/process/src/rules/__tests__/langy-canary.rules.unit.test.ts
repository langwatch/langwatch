import { describe, expect, it } from "vitest";

import { classifyLangyCanaryOutcome, langyCanaryAnswer } from "../langy-canary.rules.ts";

describe("classifyLangyCanaryOutcome", () => {
  /** @scenario "The Langy canary classifies a settled turn as main did" */
  it("names healthy, turn_failed, empty_reply and timeout", () => {
    expect(
      classifyLangyCanaryOutcome({
        succeeded: true,
        outcome: "completed",
        text: "Hi!",
        error: null,
      }),
    ).toEqual({ healthy: true });
    expect(
      classifyLangyCanaryOutcome({
        succeeded: false,
        outcome: "failed",
        text: null,
        error: "boom",
      }),
    ).toEqual({ healthy: false, reason: "turn_failed" });
    expect(
      classifyLangyCanaryOutcome({ succeeded: true, outcome: "stopped", text: "Hi", error: null }),
    ).toEqual({ healthy: false, reason: "turn_failed" });
    expect(
      classifyLangyCanaryOutcome({
        succeeded: true,
        outcome: "completed",
        text: "  \n",
        error: null,
      }),
    ).toEqual({ healthy: false, reason: "empty_reply" });
    expect(classifyLangyCanaryOutcome(null)).toEqual({ healthy: false, reason: "timeout" });
  });
});

describe("langyCanaryAnswer", () => {
  /** @scenario "The Langy canary answers main's bodies" */
  it("answers 200 ok, 503 with the reason, and 429 busy", () => {
    const ids = { conversationId: "c-1", turnId: "t-1", durationMs: 7 };
    expect(langyCanaryAnswer({ healthy: true, ...ids })).toEqual({
      status: 200,
      body: { status: "ok", ...ids },
    });
    expect(langyCanaryAnswer({ healthy: false, reason: "empty_reply", ...ids })).toEqual({
      status: 503,
      body: { status: "unhealthy", reason: "empty_reply", ...ids },
    });
    expect(langyCanaryAnswer({ busy: true })).toEqual({ status: 429, body: { status: "busy" } });
  });
});
