import { describe, it, expect } from "vitest";
import { getAdaptivePollingInterval } from "../getAdaptivePollingInterval";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { makeScenarioRunData } from "./test-helpers";

describe("getAdaptivePollingInterval()", () => {
  describe("when run data contains rows with PENDING or IN_PROGRESS status", () => {
    it("returns an interval between 2000 and 3000 ms", () => {
      const runs = [
        makeScenarioRunData({ status: ScenarioRunStatus.IN_PROGRESS }),
        makeScenarioRunData({
          scenarioRunId: "run_2",
          status: ScenarioRunStatus.SUCCESS,
        }),
      ];

      const interval = getAdaptivePollingInterval({ runs });

      expect(interval).toBeGreaterThanOrEqual(2000);
      expect(interval).toBeLessThanOrEqual(3000);
    });

    it("returns fast interval for PENDING status", () => {
      const runs = [
        makeScenarioRunData({ status: ScenarioRunStatus.PENDING }),
      ];

      const interval = getAdaptivePollingInterval({ runs });

      expect(interval).toBeGreaterThanOrEqual(2000);
      expect(interval).toBeLessThanOrEqual(3000);
    });
  });

  describe("when run data contains only settled rows", () => {
    it("returns an interval between 15000 and 30000 ms", () => {
      const runs = [
        makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS }),
        makeScenarioRunData({
          scenarioRunId: "run_2",
          status: ScenarioRunStatus.FAILED,
        }),
        makeScenarioRunData({
          scenarioRunId: "run_3",
          status: ScenarioRunStatus.ERROR,
        }),
      ];

      const interval = getAdaptivePollingInterval({ runs });

      expect(interval).toBeGreaterThanOrEqual(15000);
      expect(interval).toBeLessThanOrEqual(30000);
    });
  });

  describe("when a row transitions to IN_PROGRESS status", () => {
    it("drops the interval to between 2000 and 3000 ms", () => {
      // First call with settled data
      const settledRuns = [
        makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS }),
      ];
      const settledInterval = getAdaptivePollingInterval({
        runs: settledRuns,
      });
      expect(settledInterval).toBeGreaterThanOrEqual(15000);

      // Second call with an active run
      const activeRuns = [
        makeScenarioRunData({ status: ScenarioRunStatus.SUCCESS }),
        makeScenarioRunData({
          scenarioRunId: "run_2",
          status: ScenarioRunStatus.IN_PROGRESS,
        }),
      ];
      const activeInterval = getAdaptivePollingInterval({ runs: activeRuns });
      expect(activeInterval).toBeGreaterThanOrEqual(2000);
      expect(activeInterval).toBeLessThanOrEqual(3000);
    });
  });

  describe("when run data is empty", () => {
    it("returns the slow interval", () => {
      const interval = getAdaptivePollingInterval({ runs: [] });

      expect(interval).toBeGreaterThanOrEqual(15000);
      expect(interval).toBeLessThanOrEqual(30000);
    });
  });

  describe("when run data includes STALLED and CANCELLED statuses", () => {
    it("treats them as settled", () => {
      const runs = [
        makeScenarioRunData({ status: ScenarioRunStatus.STALLED }),
        makeScenarioRunData({
          scenarioRunId: "run_2",
          status: ScenarioRunStatus.CANCELLED,
        }),
      ];

      const interval = getAdaptivePollingInterval({ runs });

      expect(interval).toBeGreaterThanOrEqual(15000);
      expect(interval).toBeLessThanOrEqual(30000);
    });
  });
});
