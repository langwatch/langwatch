/**
 * The run dialog subject of a stored row, and the name it opens on.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { describe, expect, it } from "vitest";
import { storedPlanSubject } from "../run/plan-scope";

const RUN_PLAN = {
  id: "suite_plan",
  name: "Refunds prod-agent",
  kind: "custom",
  scope: { mode: "cases" },
  scenarioIds: ["case_1", "case_2"],
  targets: [{ type: "http", referenceId: "agent_1" }],
};

const FOLDER = {
  id: "suite_folder",
  name: "Refunds",
  kind: "folder",
  scope: null,
  scenarioIds: ["case_1"],
  targets: [{ type: "http", referenceId: "agent_1" }],
};

describe("given a stored row opened from the Results tab", () => {
  describe("when the row is a run plan", () => {
    /** @scenario "A test suite answers to no plan name, so its run still derives one" */
    it("opens on the name the plan is stored under", () => {
      expect(storedPlanSubject(RUN_PLAN).planName).toBe("Refunds prod-agent");
    });

    it("carries the plan's own rule, with its hand-picked list inside it", () => {
      expect(storedPlanSubject(RUN_PLAN).scope).toEqual({
        mode: "cases",
        caseIds: ["case_1", "case_2"],
      });
    });

    it("opens on the target of the plan's last run", () => {
      expect(storedPlanSubject(RUN_PLAN)).toMatchObject({
        initialTarget: { type: "http", id: "agent_1" },
        persistedTarget: { type: "http", referenceId: "agent_1" },
      });
    });
  });

  describe("when the row is a folder", () => {
    /** @scenario "A test suite answers to no plan name, so its run still derives one" */
    it("names no plan, so the run name is derived", () => {
      expect(storedPlanSubject(FOLDER).planName).toBeUndefined();
    });

    it("covers the scenarios filed in the folder", () => {
      expect(storedPlanSubject(FOLDER).scope).toEqual({
        mode: "folders",
        folderIds: ["suite_folder"],
      });
    });
  });
});
