/**
 * The run history transforms: how flat scenario runs fold into groups, name
 * themselves and number their iterations.
 *
 * @see specs/features/suites/run-history-group-by.feature
 * @see specs/features/suites/all-runs-scenario-names.feature
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { targetKeyOf } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import {
  computeIterationMap,
  getScenarioDisplayNames,
  groupRunsByBatchId,
  groupRunsByScenarioId,
  groupRunsByTarget,
  groupRunsByTargetKey,
} from "../run-history-transforms.ts";

function run(overrides: Partial<ScenarioRunData> = {}): ScenarioRunData {
  return {
    scenarioId: "s1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    status: ScenarioRunStatus.SUCCESS,
    messages: [],
    timestamp: 0,
    durationInMs: 0,
    ...overrides,
  };
}

function runAgainst({
  referenceId,
  parameters,
  ...overrides
}: { referenceId?: string; parameters?: Record<string, string> } & Partial<ScenarioRunData>) {
  return run({
    ...overrides,
    ...(referenceId
      ? {
          metadata: {
            langwatch: {
              targetReferenceId: referenceId,
              targetType: "http",
              targetKey: targetKeyOf({ referenceId, runParameters: parameters }),
            },
          },
        }
      : {}),
  });
}

describe("grouping runs", () => {
  describe("when the runs belong to different scenarios", () => {
    /** @scenario "groupRunsByScenarioId groups runs by their scenarioId" */
    it("folds them into one group per scenarioId holding that scenario's runs", () => {
      const groups = groupRunsByScenarioId({
        runs: [
          run({ scenarioRunId: "a", scenarioId: "s1" }),
          run({ scenarioRunId: "b", scenarioId: "s1" }),
          run({ scenarioRunId: "c", scenarioId: "s2" }),
          run({ scenarioRunId: "d", scenarioId: "s2" }),
          run({ scenarioRunId: "e", scenarioId: "s2" }),
        ],
      });

      expect(groups).toHaveLength(2);
      expect(groups.find((group) => group.groupKey === "s1")?.scenarioRuns).toHaveLength(2);
      expect(groups.find((group) => group.groupKey === "s2")?.scenarioRuns).toHaveLength(3);
    });
  });

  describe("when the runs went against different targets", () => {
    const runs = [
      run({
        scenarioRunId: "a",
        metadata: { langwatch: { targetReferenceId: "agent-1", targetType: "http" } },
      }),
      run({
        scenarioRunId: "b",
        metadata: { langwatch: { targetReferenceId: "agent-1", targetType: "http" } },
      }),
      run({
        scenarioRunId: "c",
        metadata: { langwatch: { targetReferenceId: "prompt-1", targetType: "http" } },
      }),
    ];

    /** @scenario "groupRunsByTarget groups runs by their targetReferenceId" */
    it("folds them into one group per targetReferenceId", () => {
      const groups = groupRunsByTarget({ runs, targetNameMap: new Map() });

      expect(groups).toHaveLength(2);
      expect(groups.find((group) => group.groupKey === "agent-1")?.scenarioRuns).toHaveLength(2);
      expect(groups.find((group) => group.groupKey === "prompt-1")?.scenarioRuns).toHaveLength(1);
    });
  });

  describe("when some runs carry no target metadata", () => {
    /** @scenario groupRunsByTarget places runs without target metadata in an "Unknown" group */
    it("groups them under Unknown", () => {
      const groups = groupRunsByTarget({
        runs: [
          run({
            scenarioRunId: "a",
            metadata: { langwatch: { targetReferenceId: "agent-1", targetType: "http" } },
          }),
          run({ scenarioRunId: "b" }),
          run({ scenarioRunId: "c", metadata: undefined }),
        ],
        targetNameMap: new Map(),
      });

      const unknown = groups.find((group) => group.groupLabel === "Unknown");
      expect(unknown?.groupType).toBe("target");
      expect(unknown?.scenarioRuns.map((member) => member.scenarioRunId).toSorted()).toEqual([
        "b",
        "c",
      ]);
    });
  });

  describe("when runs went against the same agent on different parameters", () => {
    /** @scenario "Runs are grouped by their target key" */
    it("folds them into one group per key, and a run from before keys folds under its reference id", () => {
      const groups = groupRunsByTargetKey({
        runs: [
          runAgainst({ scenarioRunId: "a", referenceId: "dev-agent" }),
          runAgainst({
            scenarioRunId: "b",
            referenceId: "dev-agent",
            parameters: { model: "gpt-5-mini" },
          }),
          run({
            scenarioRunId: "legacy",
            metadata: { langwatch: { targetReferenceId: "dev-agent", targetType: "http" } },
          }),
        ],
      });

      const variantKey = targetKeyOf({
        referenceId: "dev-agent",
        runParameters: { model: "gpt-5-mini" },
      });
      expect(groups.map((group) => group.groupKey).toSorted()).toEqual(
        ["dev-agent", variantKey].toSorted(),
      );
      const bare = groups.find((group) => group.groupKey === "dev-agent");
      expect(bare?.scenarioRuns.map((member) => member.scenarioRunId).toSorted()).toEqual([
        "a",
        "legacy",
      ]);
      expect(groups.find((group) => group.groupKey === variantKey)?.scenarioRuns).toHaveLength(1);
    });
  });

  describe("when the groups have different latest timestamps", () => {
    /** @scenario "Groups are sorted by most recent timestamp descending" */
    it("orders them most recent first", () => {
      const groups = groupRunsByScenarioId({
        runs: [
          run({ scenarioRunId: "a", scenarioId: "s1", timestamp: 1000 }),
          run({ scenarioRunId: "b", scenarioId: "s2", timestamp: 3000 }),
          run({ scenarioRunId: "c", scenarioId: "s3", timestamp: 2000 }),
        ],
      });

      expect(groups.map((group) => group.timestamp)).toEqual([3000, 2000, 1000]);
    });
  });

  describe("when any grouping mode completes", () => {
    /** @scenario "Every grouping mode returns groups with identifier, label, type, timestamp, and runs" */
    it("returns groups that each carry an identifier, a label, a type, a timestamp and runs", () => {
      const runs = [
        runAgainst({ scenarioRunId: "a", scenarioId: "s1", referenceId: "agent-1", timestamp: 5 }),
        run({ scenarioRunId: "b", scenarioId: "s2", batchRunId: "batch_2", timestamp: 7 }),
      ];

      const everyMode = [
        groupRunsByBatchId({ runs }),
        groupRunsByScenarioId({ runs }),
        groupRunsByTarget({ runs, targetNameMap: new Map() }),
      ];

      for (const groups of everyMode) {
        expect(groups.length).toBeGreaterThan(0);
        for (const group of groups) {
          expect(group.groupKey).toEqual(expect.any(String));
          expect(group.groupLabel).toEqual(expect.any(String));
          expect(group.groupType).toEqual(expect.any(String));
          expect(group.timestamp).toEqual(expect.any(Number));
          expect(group.scenarioRuns.length).toBeGreaterThan(0);
        }
      }
    });
  });
});

describe("naming and numbering runs", () => {
  describe("when the runs repeat a scenario name", () => {
    /** @scenario "Extracts unique sorted scenario names from batch run data" */
    it("lists each name once, in alphabetical order", () => {
      expect(
        getScenarioDisplayNames({
          scenarioRuns: [
            run({ scenarioRunId: "a", name: "Login Flow" }),
            run({ scenarioRunId: "b", name: "Checkout Flow" }),
            run({ scenarioRunId: "c", name: "Login Flow" }),
          ],
        }),
      ).toBe("Checkout Flow, Login Flow");
    });
  });

  describe("when a run has no name", () => {
    /** @scenario "Falls back to scenario ID when name is null or undefined" */
    it("reads the scenario id instead, for a null name and for an undefined one", () => {
      expect(
        getScenarioDisplayNames({
          scenarioRuns: [run({ scenarioId: "scenario-abc", name: null })],
        }),
      ).toBe("scenario-abc");
      expect(
        getScenarioDisplayNames({
          scenarioRuns: [run({ scenarioId: "scenario-abc", name: undefined })],
        }),
      ).toBe("scenario-abc");
    });
  });

  describe("when one scenario ran twice against a variant and once against the bare target", () => {
    /** @scenario "Iterations are counted per scenario and target key" */
    it("numbers the variant's runs one and two and leaves the bare target's run unnumbered", () => {
      const iterations = computeIterationMap({
        scenarioRuns: [
          runAgainst({
            scenarioRunId: "run_a",
            referenceId: "dev-agent",
            parameters: { model: "gpt-5-mini" },
          }),
          runAgainst({
            scenarioRunId: "run_b",
            referenceId: "dev-agent",
            parameters: { model: "gpt-5-mini" },
          }),
          runAgainst({ scenarioRunId: "run_c", referenceId: "dev-agent" }),
        ],
      });

      expect(iterations.get("run_a")).toBe(1);
      expect(iterations.get("run_b")).toBe(2);
      expect(iterations.has("run_c")).toBe(false);
    });
  });
});
