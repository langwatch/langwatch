/**
 * The number beside the Scenarios tab.
 * @see specs/features/agent-testing/page-structure.feature
 */

import { describe, expect, it } from "vitest";

import { countCasesInSuites } from "../test-cases.ts";

describe("given scenarios filed in and outside the listed suites", () => {
  describe("when the number beside Scenarios is worked out", () => {
    /** @scenario "The number beside the Scenarios tab counts what the suite rail can reach" */
    it("counts only the scenarios filed in a listed suite", () => {
      const cases = [
        { testSuiteId: "suite_a" },
        { testSuiteId: "suite_b" },
        { testSuiteId: "suite_archived" },
        { testSuiteId: null },
      ];

      expect(countCasesInSuites({ cases, suiteIds: ["suite_a", "suite_b"] })).toBe(2);
    });
  });
});
