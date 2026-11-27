/**
 * Which invoke failures may be retried, and how long a retry waits.
 * @see specs/nlp-go/lambda-invoke-response-contract.feature
 */
import { describe, expect, it } from "vitest";

import { invokeNeverStarted, invokeRetryDelayMs } from "../nlp-lambda-invoke-retry.rules.ts";

describe("invokeNeverStarted", () => {
  /** @scenario "An invoke the service rejected before running is retried" */
  it("is true for a throttle from the control plane", () => {
    const throttle = Object.assign(new Error("Rate Exceeded."), {
      name: "TooManyRequestsException",
    });
    expect(invokeNeverStarted(throttle)).toBe(true);
  });

  /** @scenario "An invoke that never reached the service is retried" */
  it("is true for a connection that was never established, on the error or its cause", () => {
    expect(invokeNeverStarted(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))).toBe(
      true,
    );
    expect(invokeNeverStarted(new Error("fetch failed", { cause: { code: "ENOTFOUND" } }))).toBe(
      true,
    );
  });

  /** @scenario "An invoke that may have started the function is not retried" */
  it("is false for a failure that may have reached the function", () => {
    expect(invokeNeverStarted(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(
      false,
    );
    expect(invokeNeverStarted(Object.assign(new Error("boom"), { name: "ServiceException" }))).toBe(
      false,
    );
    expect(invokeNeverStarted(null)).toBe(false);
  });

  it("backs off doubling from 500ms up to an 8s ceiling", () => {
    expect([1, 2, 3, 4, 5, 6].map(invokeRetryDelayMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });
});
