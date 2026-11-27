/**
 * @see specs/scenarios/judge-trace-wait-settings.feature
 */
import { describe, expect, it } from "vitest";

import {
  hasJudgeTraceWait,
  judgeTraceWaitErrorsOf,
  judgeTraceWaitInputOf,
  judgeTraceWaitMsOf,
  judgeTraceWaitProblemOf,
} from "../judge-trace-wait.ts";

describe("judgeTraceWaitInputOf()", () => {
  it("reads stored milliseconds as seconds", () => {
    expect(judgeTraceWaitInputOf({ traceQuietPeriodMs: 7_000, traceWaitTimeoutMs: 2_500 })).toEqual(
      { quietPeriodSeconds: "7", waitTimeoutSeconds: "2.5" },
    );
  });

  it("reads unset settings as blank inputs", () => {
    expect(judgeTraceWaitInputOf({ traceQuietPeriodMs: null })).toEqual({
      quietPeriodSeconds: "",
      waitTimeoutSeconds: "",
    });
  });
});

describe("judgeTraceWaitMsOf()", () => {
  it("sends seconds as whole milliseconds", () => {
    expect(judgeTraceWaitMsOf({ quietPeriodSeconds: " 12 ", waitTimeoutSeconds: "1.5" })).toEqual({
      traceQuietPeriodMs: 12_000,
      traceWaitTimeoutMs: 1_500,
    });
  });

  it("sends blank inputs as unset", () => {
    expect(judgeTraceWaitMsOf({ quietPeriodSeconds: "", waitTimeoutSeconds: "  " })).toEqual({
      traceQuietPeriodMs: null,
      traceWaitTimeoutMs: null,
    });
  });
});

describe("judgeTraceWaitErrorsOf()", () => {
  it("accepts the edges of each range", () => {
    expect(judgeTraceWaitErrorsOf({ quietPeriodSeconds: "0", waitTimeoutSeconds: "1" })).toEqual(
      {},
    );
    expect(judgeTraceWaitErrorsOf({ quietPeriodSeconds: "60", waitTimeoutSeconds: "300" })).toEqual(
      {},
    );
  });

  it("refuses values outside the range", () => {
    expect(judgeTraceWaitErrorsOf({ quietPeriodSeconds: "61", waitTimeoutSeconds: "0.5" })).toEqual(
      {
        quietPeriod: "Quiet period must be between 0 and 60 seconds",
        waitTimeout: "Max trace wait must be between 1 and 300 seconds",
      },
    );
  });

  it("refuses negative and non-numeric text", () => {
    const errors = judgeTraceWaitErrorsOf({ quietPeriodSeconds: "-1", waitTimeoutSeconds: "abc" });
    expect(errors.quietPeriod).toBeDefined();
    expect(errors.waitTimeout).toBeDefined();
  });
});

describe("judgeTraceWaitProblemOf()", () => {
  it("names the first refusal, or nothing when both inputs hold", () => {
    expect(judgeTraceWaitProblemOf({ quietPeriodSeconds: "", waitTimeoutSeconds: "400" })).toBe(
      "Max trace wait must be between 1 and 300 seconds",
    );
    expect(judgeTraceWaitProblemOf({ quietPeriodSeconds: "5", waitTimeoutSeconds: "" })).toBeNull();
  });
});

describe("hasJudgeTraceWait()", () => {
  it("is true only when an input holds something", () => {
    expect(hasJudgeTraceWait({ quietPeriodSeconds: "", waitTimeoutSeconds: "" })).toBe(false);
    expect(hasJudgeTraceWait({ quietPeriodSeconds: "", waitTimeoutSeconds: "30" })).toBe(true);
  });
});
