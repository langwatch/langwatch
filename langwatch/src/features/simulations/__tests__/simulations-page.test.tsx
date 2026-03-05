/**
 * @vitest-environment jsdom
 *
 * Integration tests for simulations page sorting behavior.
 *
 * Tests that internal sets are pinned to the top and remaining sets
 * are sorted by last run date.
 *
 * @see specs/scenarios/internal-set-namespace.feature
 */
import { describe, expect, it } from "vitest";
import { sortScenarioSets } from "../sort-scenario-sets";
import type { ScenarioSetData } from "~/server/scenarios/scenario-event.types";

describe("sortScenarioSets()", () => {

  describe("given a mix of internal and user sets", () => {
    const testSets: ScenarioSetData[] = [
      {
        scenarioSetId: "my-production-tests",
        scenarioCount: 5,
        lastRunAt: new Date("2024-01-15T10:00:00").getTime(),
      },
      {
        scenarioSetId: "__internal__proj_abc123__on-platform-scenarios",
        scenarioCount: 3,
        lastRunAt: new Date("2024-01-10T10:00:00").getTime(),
      },
      {
        scenarioSetId: "nightly-tests",
        scenarioCount: 7,
        lastRunAt: new Date("2024-01-14T10:00:00").getTime(),
      },
    ];

    describe("when sorting the sets", () => {
      it("pins internal set to the top of the list", () => {
        const sorted = sortScenarioSets(testSets);

        expect(sorted[0]?.scenarioSetId).toBe(
          "__internal__proj_abc123__on-platform-scenarios"
        );
      });

      it("sorts remaining sets by last run date (most recent first)", () => {
        const sorted = sortScenarioSets(testSets);

        // After the internal set, sets should be sorted by lastRunAt descending
        expect(sorted[1]?.scenarioSetId).toBe("my-production-tests");
        expect(sorted[2]?.scenarioSetId).toBe("nightly-tests");
      });
    });
  });

  describe("given only user sets (no internal sets)", () => {
    const testSets: ScenarioSetData[] = [
      {
        scenarioSetId: "nightly-tests",
        scenarioCount: 7,
        lastRunAt: new Date("2024-01-14T10:00:00").getTime(),
      },
      {
        scenarioSetId: "my-production-tests",
        scenarioCount: 5,
        lastRunAt: new Date("2024-01-15T10:00:00").getTime(),
      },
    ];

    describe("when sorting the sets", () => {
      it("sorts by last run date (most recent first)", () => {
        const sorted = sortScenarioSets(testSets);

        expect(sorted[0]?.scenarioSetId).toBe("my-production-tests");
        expect(sorted[1]?.scenarioSetId).toBe("nightly-tests");
      });
    });
  });

  describe("given only internal sets", () => {
    const testSets: ScenarioSetData[] = [
      {
        scenarioSetId: "__internal__proj_abc123__on-platform-scenarios",
        scenarioCount: 3,
        lastRunAt: new Date("2024-01-10T10:00:00").getTime(),
      },
      {
        scenarioSetId: "__internal__proj_xyz__on-platform-scenarios",
        scenarioCount: 2,
        lastRunAt: new Date("2024-01-12T10:00:00").getTime(),
      },
    ];

    describe("when sorting the sets", () => {
      it("sorts internal sets by last run date (most recent first)", () => {
        const sorted = sortScenarioSets(testSets);

        expect(sorted[0]?.scenarioSetId).toBe(
          "__internal__proj_xyz__on-platform-scenarios"
        );
        expect(sorted[1]?.scenarioSetId).toBe(
          "__internal__proj_abc123__on-platform-scenarios"
        );
      });
    });
  });

  describe("given an empty array", () => {
    describe("when sorting", () => {
      it("returns an empty array", () => {
        const sorted = sortScenarioSets([]);

        expect(sorted).toEqual([]);
      });
    });
  });
});
