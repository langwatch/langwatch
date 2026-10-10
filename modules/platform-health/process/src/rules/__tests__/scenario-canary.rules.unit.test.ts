import { ScenarioRunStatus, Verdict } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { canaryAnswer, classifyCanaryOutcome } from "../scenario-canary.rules.ts";

describe("classifyCanaryOutcome", () => {
  /** @scenario "A failed scenario canary run reports the run error's cause" */
  it("names a run that errored for want of credits run_failed with cause insufficient_quota", () => {
    const outcome = classifyCanaryOutcome({
      status: ScenarioRunStatus.ERROR,
      results: {
        verdict: Verdict.FAILURE,
        metCriteria: [],
        unmetCriteria: [],
        error: JSON.stringify({
          name: "Error",
          message:
            "[UserSimulatorAgent] AI_RetryError: Failed after 3 attempts. Last error: You have no credits remaining.",
        }),
      },
    });

    expect(outcome).toEqual({ healthy: false, reason: "run_failed", cause: "insufficient_quota" });
  });
});

describe("canaryAnswer", () => {
  /** @scenario "The scenario canary answers main's bodies for a healthy run and a busy plan" */
  it("answers 200 ok with the run and its duration, and 429 busy", () => {
    expect(canaryAnswer({ healthy: true, scenarioRunId: "run-1", durationMs: 12 })).toEqual({
      status: 200,
      body: { status: "ok", scenarioRunId: "run-1", durationMs: 12 },
    });
    expect(canaryAnswer({ busy: true })).toEqual({ status: 429, body: { status: "busy" } });
  });

  /** @scenario "The scenario probe answers 503 with the cause beside the reason" */
  it("answers an unhealthy run with a cause 503 carrying reason and cause", () => {
    expect(
      canaryAnswer({
        healthy: false,
        reason: "run_failed",
        cause: "insufficient_quota",
        scenarioRunId: "canary-run-abc",
        durationMs: 9000,
      }),
    ).toEqual({
      status: 503,
      body: {
        status: "unhealthy",
        reason: "run_failed",
        cause: "insufficient_quota",
        scenarioRunId: "canary-run-abc",
        durationMs: 9000,
      },
    });
  });
});
