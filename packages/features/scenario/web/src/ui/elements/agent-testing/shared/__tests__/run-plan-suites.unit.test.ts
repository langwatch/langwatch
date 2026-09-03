/**
 * Which suites of a project are run plans.
 *
 * One rule serves the number beside the Results tab and the rows of the Test
 * Runs list, so the two can never disagree.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { describe, expect, it } from "vitest";
import {
  CLI_EPHEMERAL_LABEL,
  toRunPlanSuites,
} from "../../../../../behavior/agent-testing/results/run-plans";

const RUN_PLAN = { id: "suite_plan", kind: "run_plan", labels: [] };
const TEST_SUITE = { id: "test_suite_refunds", kind: "test_suite", labels: [] };
const CLI_SUITE = {
  id: "suite_cli",
  kind: "run_plan",
  labels: [CLI_EPHEMERAL_LABEL],
};

describe("given the suites of a project", () => {
  describe("when the run plans are worked out", () => {
    /** @scenario "The number beside the Results tab counts what the Test Runs list holds" */
    it("counts the run plan alone", () => {
      expect(toRunPlanSuites([RUN_PLAN, TEST_SUITE, CLI_SUITE]).map((suite) => suite.id)).toEqual([
        "suite_plan",
      ]);
    });

    it("keeps a suite that names no kind, which is a plan the wire did not label", () => {
      expect(toRunPlanSuites([{ id: "suite_old", labels: [] }])).toHaveLength(1);
    });
  });
});
