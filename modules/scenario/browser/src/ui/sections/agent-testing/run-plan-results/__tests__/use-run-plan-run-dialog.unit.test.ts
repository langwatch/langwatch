/**
 * The run dialog subject for running one scenario again.
 *
 * @see modules/scenario/specs/simulation-run.feature
 */

import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { afterEach, describe, expect, it } from "vitest";

import { writeScenarioTarget } from "../../../use-scenario-target.ts";
import { runAgainSubjectOf } from "../use-run-plan-run-dialog.ts";

const PROJECT_ID = "project_1";

function platformRun(langwatch: Record<string, unknown>): ScenarioRunData {
  return {
    scenarioId: "scen_1",
    name: "Refund flow",
    metadata: { langwatch },
  } as ScenarioRunData;
}

describe("runAgainSubjectOf()", () => {
  afterEach(() => {
    localStorage.clear();
  });

  describe("when the run names its target type", () => {
    it("preselects the target the run used", () => {
      writeScenarioTarget({
        projectId: PROJECT_ID,
        scenarioId: "scen_1",
        target: { type: "prompt", id: "prompt_1" },
      });

      const subject = runAgainSubjectOf({
        scenarioRun: platformRun({ targetReferenceId: "agent_1", targetType: "http" }),
        projectId: PROJECT_ID,
      });

      expect(subject).toEqual({
        kind: "case",
        scenarioId: "scen_1",
        name: "Refund flow",
        initialTarget: { type: "http", id: "agent_1" },
      });
    });
  });

  describe("when the run carries no target type", () => {
    /** @scenario "Running again a run with no target type offers the scenario's last chosen target" */
    it("preselects the target last chosen for the scenario", () => {
      writeScenarioTarget({
        projectId: PROJECT_ID,
        scenarioId: "scen_1",
        target: { type: "prompt", id: "prompt_1" },
      });

      const subject = runAgainSubjectOf({
        scenarioRun: platformRun({ targetReferenceId: "agent_1" }),
        projectId: PROJECT_ID,
      });

      expect(subject.initialTarget).toEqual({ type: "prompt", id: "prompt_1" });
    });

    /** @scenario "Running again a run with no target type offers the scenario's last chosen target" */
    it("preselects nothing when no target was chosen for the scenario", () => {
      const subject = runAgainSubjectOf({
        scenarioRun: platformRun({ targetReferenceId: "agent_1" }),
        projectId: PROJECT_ID,
      });

      expect(subject.initialTarget).toBeNull();
    });
  });
});
