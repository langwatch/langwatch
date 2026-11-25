/**
 * The polling interval of the run history freshness probe: fast while a run is active.
 * @see specs/features/suites/real-time-run-updates.feature
 */
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { getAdaptivePollingInterval } from "../adaptive-polling-interval.ts";

const rows = (...statuses: ScenarioRunStatus[]) => statuses.map((status) => ({ status }));

describe("getAdaptivePollingInterval()", () => {
  describe("given run data that holds PENDING or IN_PROGRESS rows", () => {
    /** @scenario Polling interval is fast when runs are in progress */
    it("is between 2 and 3 seconds", () => {
      const interval = getAdaptivePollingInterval({
        runs: rows(
          ScenarioRunStatus.SUCCESS,
          ScenarioRunStatus.IN_PROGRESS,
          ScenarioRunStatus.PENDING,
        ),
      });

      expect(interval).toBeGreaterThanOrEqual(2_000);
      expect(interval).toBeLessThanOrEqual(3_000);
    });

    it.each([
      ScenarioRunStatus.QUEUED,
      ScenarioRunStatus.RUNNING,
      ScenarioRunStatus.PENDING_EVALUATION,
    ])("also reads %s as active, since its verdict can still change", (status) => {
      expect(getAdaptivePollingInterval({ runs: rows(status) })).toBeLessThanOrEqual(3_000);
    });
  });

  describe("given run data that holds only SUCCESS, FAILED or ERROR rows", () => {
    /** @scenario Polling interval is slow when all runs are settled */
    it("is between 15 and 30 seconds", () => {
      const interval = getAdaptivePollingInterval({
        runs: rows(ScenarioRunStatus.SUCCESS, ScenarioRunStatus.FAILED, ScenarioRunStatus.ERROR),
      });

      expect(interval).toBeGreaterThanOrEqual(15_000);
      expect(interval).toBeLessThanOrEqual(30_000);
    });

    it("is slow too when no run has loaded yet", () => {
      expect(getAdaptivePollingInterval({ runs: [] })).toBeGreaterThanOrEqual(15_000);
    });
  });

  describe("given run data that previously held only settled rows", () => {
    /** @scenario Polling interval returns to fast when a new run starts */
    it("drops to between 2 and 3 seconds once a row transitions to IN_PROGRESS", () => {
      const before = getAdaptivePollingInterval({ runs: rows(ScenarioRunStatus.SUCCESS) });
      const after = getAdaptivePollingInterval({
        runs: rows(ScenarioRunStatus.SUCCESS, ScenarioRunStatus.IN_PROGRESS),
      });

      expect(before).toBeGreaterThanOrEqual(15_000);
      expect(after).toBeGreaterThanOrEqual(2_000);
      expect(after).toBeLessThanOrEqual(3_000);
    });
  });
});
