/**
 * Every simulations address has an Agent Testing address that shows the same
 * thing. These pin the mapping the v1 page follows when the project reads
 * Agent Testing.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { describe, expect, it } from "vitest";
import { toAgentTestingAddress } from "../useSuiteRouting";

const address = (segments: string[], query: Record<string, unknown> = {}) =>
  toAgentTestingAddress({ projectSlug: "acme", segments, query });

describe("toAgentTestingAddress", () => {
  describe("given the run history", () => {
    /** @scenario "Every simulations address has an Agent Testing address" */
    it("opens the results list", () => {
      expect(address([])).toBe("/acme/agent-testing/results");
    });
  });

  describe("given the scenario library", () => {
    it("opens the scenarios tab", () => {
      expect(address(["scenarios"])).toBe("/acme/agent-testing");
    });

    it("opens the case editor on the scenario the address names", () => {
      expect(address(["scenarios", "scenario_1"])).toBe(
        "/acme/agent-testing?drawer.open=agentTestingCaseEditor&drawer.scenarioId=scenario_1",
      );
    });

    it("reads the v1 editor drawer as the case editor", () => {
      expect(
        address(["scenarios"], {
          "drawer.open": "scenarioEditor",
          "drawer.scenarioId": "scenario_2",
        }),
      ).toBe(
        "/acme/agent-testing?drawer.open=agentTestingCaseEditor&drawer.scenarioId=scenario_2",
      );
    });
  });

  describe("given a run plan", () => {
    it("opens the plan", () => {
      expect(address(["run-plans", "nightly"])).toBe(
        "/acme/agent-testing/results/nightly",
      );
    });

    it("opens the batch of the plan", () => {
      expect(address(["run-plans", "nightly", "batch_1"])).toBe(
        "/acme/agent-testing/results/nightly/batch_1",
      );
    });

    it("opens the results list when the address names no plan", () => {
      expect(address(["run-plans"])).toBe("/acme/agent-testing/results");
    });
  });

  describe("given a legacy suites address", () => {
    it("opens the plan the query names", () => {
      expect(address(["suites"], { suite: "nightly" })).toBe(
        "/acme/agent-testing/results/nightly",
      );
    });

    it("opens the set the query names", () => {
      expect(address(["suites"], { externalSet: "my-set" })).toBe(
        "/acme/agent-testing/results/external:my-set",
      );
    });

    it("opens the results list when it names neither", () => {
      expect(address(["suites"])).toBe("/acme/agent-testing/results");
    });
  });

  describe("given a run set a code run writes into", () => {
    it("opens the set as a plan", () => {
      expect(address(["my-set"])).toBe(
        "/acme/agent-testing/results/external:my-set",
      );
    });

    it("opens the batch of the set, the address the scenario library prints", () => {
      expect(address(["my-set", "batch_1"])).toBe(
        "/acme/agent-testing/results/external:my-set/batch_1",
      );
    });

    it("opens the batch with the run detail drawer open on the run", () => {
      expect(address(["my-set", "batch_1", "run_1"])).toBe(
        "/acme/agent-testing/results/external:my-set/batch_1?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
    });

    it("reads the openRun query the v1 redirect wrote as the run detail drawer", () => {
      expect(address(["my-set", "batch_1"], { openRun: "run_1" })).toBe(
        "/acme/agent-testing/results/external:my-set/batch_1?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
    });
  });

  describe("given one of the platform's own sets", () => {
    it("opens the results list, where the plan of the set is", () => {
      expect(address(["__internal__project_1__on-platform-scenarios"])).toBe(
        "/acme/agent-testing/results",
      );
    });

    it("still opens the run the address names", () => {
      expect(
        address([
          "__internal__project_1__on-platform-scenarios",
          "batch_1",
          "run_1",
        ]),
      ).toBe(
        "/acme/agent-testing/results?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1",
      );
    });
  });

  describe("given query params that describe the view", () => {
    it("carries the period, the grouping, an open drawer and the tab key", () => {
      expect(
        address(["run-plans", "nightly"], {
          project: "acme",
          path: ["run-plans", "nightly"],
          period: "7d",
          groupBy: "target",
          "drawer.open": "scenarioRunDetail",
          "drawer.scenarioRunId": "run_3",
          scenarioTab: "tab_9",
        }),
      ).toBe(
        "/acme/agent-testing/results/nightly?period=7d&groupBy=target&drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_3&scenarioTab=tab_9",
      );
    });

    it("carries a repeated param once per value", () => {
      expect(address([], { passFailStatus: ["passed", "failed"] })).toBe(
        "/acme/agent-testing/results?passFailStatus=passed&passFailStatus=failed",
      );
    });

    it("drops a query string that leaked into the segments", () => {
      expect(address(["my-set", "?period=7d"])).toBe(
        "/acme/agent-testing/results/external:my-set",
      );
    });
  });
});
