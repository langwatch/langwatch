/**
 * Regression for langwatch#8507: an error result with no `details` must not throw
 * in `timedOut`, so the real evaluator error reaches the caller.
 */
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { describe, expect, it } from "vitest";
import { timedOut } from "../evaluations-legacy.rest.ts";

const errorResult = (details?: string): SingleEvaluationResult =>
  ({ status: "error", ...(details === undefined ? {} : { details }) }) as SingleEvaluationResult;

describe("timedOut", () => {
  it("returns false, without throwing, when an error result has no details (AC#1)", () => {
    const result = errorResult();
    expect(() => timedOut(result)).not.toThrow();
    expect(timedOut(result)).toBe(false);
  });

  it("returns false when details is an empty string", () => {
    expect(timedOut(errorResult(""))).toBe(false);
  });

  it("detects a timeout when details contains 'timed out' (AC#2)", () => {
    expect(timedOut(errorResult("Evaluator request timed out after 30s"))).toBe(true);
  });

  it("is case-insensitive, matching the original lowercase comparison", () => {
    expect(timedOut(errorResult("Request TIMED OUT"))).toBe(true);
  });

  it("returns false for a non-timeout error message", () => {
    expect(timedOut(errorResult("invalid api key"))).toBe(false);
  });

  it("returns false for a non-error result regardless of details", () => {
    expect(timedOut({ status: "processed" } as SingleEvaluationResult)).toBe(false);
  });
});
