import { describe, expect, it } from "vitest";

import { canaryAnswer } from "../scenario-canary.rules.ts";

describe("canaryAnswer", () => {
  /** @scenario "The scenario canary answers main's bodies for a healthy run and a busy plan" */
  it("answers 200 ok with the run and its duration, and 429 busy", () => {
    expect(canaryAnswer({ healthy: true, scenarioRunId: "run-1", durationMs: 12 })).toEqual({
      status: 200,
      body: { status: "ok", scenarioRunId: "run-1", durationMs: 12 },
    });
    expect(canaryAnswer({ busy: true })).toEqual({ status: 429, body: { status: "busy" } });
  });
});
