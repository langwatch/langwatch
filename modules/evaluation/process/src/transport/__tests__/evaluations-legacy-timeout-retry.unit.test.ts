/**
 * Regression: the legacy evaluations REST route decided whether to retry an
 * errored evaluation by calling `result.details.toLowerCase()`. `details` is
 * typed as a required string, but an evaluator can return `status: "error"`
 * with no `details` at runtime. The unguarded read threw
 * `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`,
 * which the dispatch's catch swallowed as a generic INTERNAL_ERROR, losing the
 * real evaluator error (langwatch/tasks#8507; seen on prod across several
 * projects between 2026-09-30 and 2026-10-07).
 *
 * `timedOut` is the retry predicate. These pin:
 *  - an errored result with a missing `details` is not a timeout and does NOT
 *    throw (AC#1/#2), so the original error result falls through and is
 *    returned to the caller.
 *  - `details` containing "timed out" is still detected (AC#2), so a genuine
 *    timeout is retried as before.
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
