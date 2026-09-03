/**
 * The stored shape of a run plan scope.
 *
 * @see specs/suites/run-plan-dynamic-scopes.feature
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS_SCOPE, isDynamicScope, parseSuiteScope, suiteScopeSchema } from "../suite.scope";

describe("suite scope", () => {
  /** @scenario "The stored shape of every mode is known" */
  it("parses every supported scope", () => {
    expect(parseSuiteScope({ mode: "all" })).toEqual({ mode: "all" });
    expect(parseSuiteScope({ mode: "test_suites", testSuiteIds: ["suite_1"] })).toEqual({
      mode: "test_suites",
      testSuiteIds: ["suite_1"],
    });
    expect(parseSuiteScope({ mode: "labels", labels: ["checkout"] })).toEqual({
      mode: "labels",
      labels: ["checkout"],
    });
    expect(parseSuiteScope({ mode: "scenarios" })).toEqual(SCENARIOS_SCOPE);
  });

  /** @scenario "The stored shape of every mode is known" */
  it("rejects malformed scopes", () => {
    expect(suiteScopeSchema.safeParse({ mode: "everything" }).success).toBe(false);
    expect(suiteScopeSchema.safeParse({ mode: "test_suites" }).success).toBe(false);
    expect(suiteScopeSchema.safeParse({ mode: "labels" }).success).toBe(false);
  });

  /** @scenario "The stored shape of every mode is known" */
  it("reads legacy and unknown values as a hand-picked scenario scope", () => {
    expect(parseSuiteScope(null)).toEqual(SCENARIOS_SCOPE);
    expect(parseSuiteScope(void 0)).toEqual(SCENARIOS_SCOPE);
    expect(parseSuiteScope({ mode: "everything" })).toEqual(SCENARIOS_SCOPE);
  });

  /** @scenario "The stored shape of every mode is known" */
  it("identifies scopes resolved at run time", () => {
    expect(isDynamicScope({ mode: "all" })).toBe(true);
    expect(isDynamicScope({ mode: "test_suites", testSuiteIds: [] })).toBe(true);
    expect(isDynamicScope({ mode: "labels", labels: [] })).toBe(true);
    expect(isDynamicScope(SCENARIOS_SCOPE)).toBe(false);
  });
});
