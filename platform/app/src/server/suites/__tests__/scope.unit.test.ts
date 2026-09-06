/**
 * The stored shape of a run plan scope.
 *
 * @see specs/suites/run-plan-dynamic-scopes.feature
 */
import { describe, expect, it } from "vitest";
import {
  isDynamicScope,
  parseSuiteScope,
  SCENARIOS_SCOPE,
  suiteScopeSchema,
} from "../scope";

describe("reading a stored scope", () => {
  describe("when the value names one of the four modes", () => {
    /** @scenario "The stored shape of every mode is known" */
    it("reads each mode with the list it carries", () => {
      expect(parseSuiteScope({ mode: "all" })).toEqual({ mode: "all" });
      expect(
        parseSuiteScope({ mode: "test_suites", testSuiteIds: ["suite_1"] }),
      ).toEqual({ mode: "test_suites", testSuiteIds: ["suite_1"] });
      expect(parseSuiteScope({ mode: "labels", labels: ["checkout"] })).toEqual(
        {
          mode: "labels",
          labels: ["checkout"],
        },
      );
      expect(parseSuiteScope({ mode: "scenarios" })).toEqual(SCENARIOS_SCOPE);
    });
  });

  describe("when the value is not one of the four modes", () => {
    /** @scenario "The stored shape of every mode is known" */
    it("refuses an unknown mode and a mode missing its list", () => {
      expect(suiteScopeSchema.safeParse({ mode: "everything" }).success).toBe(
        false,
      );
      expect(suiteScopeSchema.safeParse({ mode: "test_suites" }).success).toBe(
        false,
      );
      expect(suiteScopeSchema.safeParse({ mode: "labels" }).success).toBe(
        false,
      );
    });

    /** @scenario "The stored shape of every mode is known" */
    it("reads a plan written before scopes as the list it holds", () => {
      expect(parseSuiteScope(null)).toEqual(SCENARIOS_SCOPE);
      expect(parseSuiteScope(undefined)).toEqual(SCENARIOS_SCOPE);
      expect(parseSuiteScope({ mode: "everything" })).toEqual(SCENARIOS_SCOPE);
    });
  });

  describe("when the run asks which scopes it must resolve", () => {
    /** @scenario "The stored shape of every mode is known" */
    it("names every mode but the hand-picked list", () => {
      expect(isDynamicScope({ mode: "all" })).toBe(true);
      expect(isDynamicScope({ mode: "test_suites", testSuiteIds: [] })).toBe(
        true,
      );
      expect(isDynamicScope({ mode: "labels", labels: [] })).toBe(true);
      expect(isDynamicScope(SCENARIOS_SCOPE)).toBe(false);
    });
  });
});
