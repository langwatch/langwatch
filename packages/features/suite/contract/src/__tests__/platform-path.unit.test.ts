/**
 * @vitest-environment node
 *
 * The addresses the platform hands out, per interface.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { describe, expect, it } from "vitest";
import {
  batchRunPath,
  scenarioEditorPath,
  scenarioRunPath,
  scenarioSetPath,
} from "../platform-path";

describe("the addresses the platform hands out", () => {
  describe("given the project reads Agent Testing", () => {
    const ui = "agent_testing" as const;

    /** @scenario "The addresses the platform hands out name the interface the project reads" */
    it("lists a set a code run writes into as a plan of its own", () => {
      expect(scenarioSetPath({ ui, scenarioSetId: "python-examples" })).toBe(
        "/agent-testing/results/external:python-examples",
      );
    });

    it("keeps the set prefix readable and encodes only the id", () => {
      expect(scenarioSetPath({ ui, scenarioSetId: "a b/c" })).toBe(
        "/agent-testing/results/external:a%20b%2Fc",
      );
    });

    it("opens the platform's own set on the results list, under its plans", () => {
      expect(
        scenarioSetPath({
          ui,
          scenarioSetId: "__internal__project_1__on-platform-scenarios",
        }),
      ).toBe("/agent-testing/results");
    });

    it("names a batch under the plan of its set, the address the scenario library composes", () => {
      expect(
        batchRunPath({
          ui,
          scenarioSetId: "python-examples",
          batchRunId: "batch_1",
        }),
      ).toBe("/agent-testing/results/external:python-examples/batch_1");
    });

    it("names no batch for the platform's own set, which the results list reads none of", () => {
      expect(
        batchRunPath({
          ui,
          scenarioSetId: "__internal__project_1__on-platform-scenarios",
          batchRunId: "batch_1",
        }),
      ).toBe("/agent-testing/results");
    });

    it("opens a run in the run detail drawer over the results", () => {
      expect(scenarioRunPath({ ui, scenarioRunId: "run?1&2" })).toBe(
        "/agent-testing/results?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run%3F1%262",
      );
    });

    it("opens a scenario in the case editor over the scenarios", () => {
      expect(scenarioEditorPath({ ui, scenarioId: "scenario_1" })).toBe(
        "/agent-testing?drawer.open=agentTestingCaseEditor&drawer.scenarioId=scenario_1",
      );
    });
  });

  describe("given the project reads the Simulations pages", () => {
    const ui = "simulations" as const;

    it("opens a set on its own page", () => {
      expect(scenarioSetPath({ ui, scenarioSetId: "python-examples" })).toBe(
        "/simulations/python-examples",
      );
    });

    it("names a batch under its set", () => {
      expect(
        batchRunPath({
          ui,
          scenarioSetId: "checkout flow",
          batchRunId: "batch#1",
        }),
      ).toBe("/simulations/checkout%20flow/batch%231");
    });

    it("opens a run in the run detail drawer over the run history", () => {
      expect(scenarioRunPath({ ui, scenarioRunId: "run_1" })).toBe(
        "/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
    });

    it("opens a scenario in the editor over the scenario library", () => {
      expect(scenarioEditorPath({ ui, scenarioId: "scenario_1" })).toBe(
        "/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=scenario_1",
      );
    });
  });
});
