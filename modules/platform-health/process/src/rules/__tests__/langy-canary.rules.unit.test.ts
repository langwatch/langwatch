import { describe, expect, it } from "vitest";

import { classifyLangyCanaryOutcome, langyCanaryAnswer } from "../langy-canary.rules.ts";

describe("classifyLangyCanaryOutcome", () => {
  /** @scenario "The Langy canary classifies a settled turn as main did" */
  /** @scenario "A completed turn with text is healthy" */
  it("names a completed turn with text healthy", () => {
    expect(
      classifyLangyCanaryOutcome({
        succeeded: true,
        outcome: "completed",
        text: "Hi!",
        error: null,
      }),
    ).toEqual({ healthy: true });
  });

  /** @scenario "The Langy canary classifies a settled turn as main did" */
  /** @scenario "A failed turn is turn_failed" */
  it("names a failed turn turn_failed", () => {
    expect(
      classifyLangyCanaryOutcome({
        succeeded: false,
        outcome: "failed",
        text: null,
        error: "boom",
      }),
    ).toEqual({ healthy: false, reason: "turn_failed" });
  });

  /** @scenario "The Langy canary classifies a settled turn as main did" */
  /** @scenario "A stopped turn is turn_failed" */
  it("names a stopped turn turn_failed, whatever text it carries", () => {
    expect(
      classifyLangyCanaryOutcome({ succeeded: true, outcome: "stopped", text: "Hi", error: null }),
    ).toEqual({ healthy: false, reason: "turn_failed" });
  });

  /** @scenario "The Langy canary classifies a settled turn as main did" */
  /** @scenario "A completed turn with only whitespace is empty_reply" */
  it("names a completed turn with only whitespace empty_reply", () => {
    expect(
      classifyLangyCanaryOutcome({
        succeeded: true,
        outcome: "completed",
        text: "  \n",
        error: null,
      }),
    ).toEqual({ healthy: false, reason: "empty_reply" });
  });

  /** @scenario "The Langy canary classifies a settled turn as main did" */
  /** @scenario "A turn that never settled is timeout" */
  it("names a turn that never settled timeout", () => {
    expect(classifyLangyCanaryOutcome(null)).toEqual({ healthy: false, reason: "timeout" });
  });
});

describe("langyCanaryAnswer", () => {
  const ids = { conversationId: "c-1", turnId: "t-1", durationMs: 7 };

  /** @scenario "The Langy canary answers main's bodies" */
  /** @scenario "A healthy run answers 200 with the turn's ids" */
  it("answers a healthy run 200 ok with the conversation id, turn id and duration", () => {
    expect(langyCanaryAnswer({ healthy: true, ...ids })).toEqual({
      status: 200,
      body: { status: "ok", ...ids },
    });
  });

  /** @scenario "The Langy canary answers main's bodies" */
  /** @scenario "An unhealthy run answers 503 with its reason" */
  it("answers an unhealthy run 503 with its reason", () => {
    expect(langyCanaryAnswer({ healthy: false, reason: "empty_reply", ...ids })).toEqual({
      status: 503,
      body: { status: "unhealthy", reason: "empty_reply", ...ids },
    });
  });

  /** @scenario "The Langy canary answers main's bodies" */
  /** @scenario "A busy probe answers 429" */
  it("answers a busy probe 429", () => {
    expect(langyCanaryAnswer({ busy: true })).toEqual({ status: 429, body: { status: "busy" } });
  });
});
