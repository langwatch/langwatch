/**
 * The targets of one run, as the run detail orders, names and colours them.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { describe, expect, it } from "vitest";
import type { TargetIdentity } from "~/hooks/useTargetNameMap";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { targetKeyOf } from "~/server/suites/target-key";
import {
  batchTargetsOf,
  isComparison,
  runsOfTarget,
  summaryOfTarget,
} from "../results/useBatchTargets";
import { TARGET_COLORS } from "../shared/target-colors";

const NAMES = new Map<string, TargetIdentity>([
  [
    "agent_dev",
    {
      name: "dev-agent",
      kind: "connected",
      environment: null,
      ownerName: null,
    },
  ],
  [
    "agent_prod",
    { name: "prod-agent", kind: "http", environment: null, ownerName: null },
  ],
]);

/** One run against a target, with the overrides the platform stamped on it. */
function runAgainst({
  scenarioRunId,
  referenceId,
  parameters,
  status = ScenarioRunStatus.SUCCESS,
}: {
  scenarioRunId: string;
  referenceId: string;
  parameters?: Record<string, string>;
  status?: ScenarioRunStatus;
}): ScenarioRunData {
  return {
    scenarioId: "scen_1",
    batchRunId: "batch_1",
    scenarioRunId,
    status,
    messages: [],
    timestamp: 0,
    durationInMs: 0,
    metadata: {
      langwatch: {
        targetReferenceId: referenceId,
        targetType: "http",
        targetKey: targetKeyOf({ referenceId, runParameters: parameters }),
        ...(parameters ? { targetParameters: parameters } : {}),
      },
    },
  } as ScenarioRunData;
}

describe("batchTargetsOf()", () => {
  describe("when the runs go against several targets in any order", () => {
    /** @scenario "The targets of a run are ordered and coloured by position" */
    it("orders the targets by agent and then by parameters, and colours each by its position", () => {
      const targets = batchTargetsOf({
        scenarioRuns: [
          runAgainst({ scenarioRunId: "r1", referenceId: "agent_prod" }),
          runAgainst({
            scenarioRunId: "r2",
            referenceId: "agent_dev",
            parameters: { model: "b" },
          }),
          runAgainst({
            scenarioRunId: "r3",
            referenceId: "agent_dev",
            parameters: { model: "a" },
          }),
        ],
        targetIdentities: NAMES,
      });

      expect(targets.map((target) => target.label)).toEqual([
        "dev-agent · model=a",
        "dev-agent · model=b",
        "prod-agent",
      ]);
      expect(targets.map((target) => target.color)).toEqual([
        TARGET_COLORS[0],
        TARGET_COLORS[1],
        TARGET_COLORS[2],
      ]);
      expect(isComparison(targets)).toBe(true);
    });
  });

  describe("when an agent with parameters is alone with its agent", () => {
    /** @scenario "A target that is alone with its agent keeps its bare name" */
    it("keeps the bare name and still carries the parameters", () => {
      const targets = batchTargetsOf({
        scenarioRuns: [
          runAgainst({
            scenarioRunId: "r1",
            referenceId: "agent_dev",
            parameters: { model: "gpt-5-mini" },
          }),
          runAgainst({ scenarioRunId: "r2", referenceId: "agent_prod" }),
        ],
        targetIdentities: NAMES,
      });

      expect(targets.map((target) => target.label)).toEqual([
        "dev-agent",
        "prod-agent",
      ]);
      expect(targets[0]?.name).toBe("dev-agent");
      expect(targets[0]?.parameters).toEqual({ model: "gpt-5-mini" });
      expect(targets[1]?.parameters).toBeNull();
    });
  });

  describe("when the targets of one agent share a value", () => {
    /** @scenario "The targets of a repeated agent read the parameters that differ" */
    it("labels each with the parameters that differ and leaves the shared one out", () => {
      const targets = batchTargetsOf({
        scenarioRuns: [
          runAgainst({
            scenarioRunId: "r1",
            referenceId: "agent_dev",
            parameters: { locale: "de", model: "a" },
          }),
          runAgainst({
            scenarioRunId: "r2",
            referenceId: "agent_dev",
            parameters: { locale: "de", model: "b" },
          }),
        ],
        targetIdentities: NAMES,
      });

      expect(targets.map((target) => target.label)).toEqual([
        "dev-agent · model=a",
        "dev-agent · model=b",
      ]);
      expect(targets.map((target) => target.shortLabel)).toEqual([
        "model=a",
        "model=b",
      ]);
      expect(targets[0]?.parameters).toEqual({ locale: "de", model: "a" });
    });
  });

  describe("when a repeated agent has one target with no differing parameter", () => {
    /** @scenario "The charts of a comparison run put the targets next to each other" */
    it("reads that target as default under a bar, and a lone agent as its name", () => {
      const targets = batchTargetsOf({
        scenarioRuns: [
          runAgainst({ scenarioRunId: "r1", referenceId: "agent_dev" }),
          runAgainst({
            scenarioRunId: "r2",
            referenceId: "agent_dev",
            parameters: { model: "gpt-5-mini" },
          }),
          runAgainst({ scenarioRunId: "r3", referenceId: "agent_prod" }),
        ],
        targetIdentities: NAMES,
      });

      expect(targets.map((target) => target.shortLabel)).toEqual([
        "default",
        "model=gpt-5-mini",
        "prod-agent",
      ]);
    });
  });

  describe("when the runs were recorded before targets carried a key", () => {
    /** @scenario "An older run with no target key reads as one column" */
    it("reads one target under its reference id", () => {
      const old = runAgainst({ scenarioRunId: "r1", referenceId: "agent_dev" });
      delete (old.metadata!.langwatch as { targetKey?: string }).targetKey;

      const targets = batchTargetsOf({
        scenarioRuns: [old, { ...old, scenarioRunId: "r2" }],
        targetIdentities: NAMES,
      });

      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({
        key: "agent_dev",
        referenceId: "agent_dev",
        name: "dev-agent",
        label: "dev-agent",
        parameters: null,
      });
      expect(isComparison(targets)).toBe(false);
    });
  });

  describe("when a run names no target at all", () => {
    it("leaves it out, and an agent the project no longer names reads by its id", () => {
      const targets = batchTargetsOf({
        scenarioRuns: [
          runAgainst({ scenarioRunId: "r1", referenceId: "agent_gone" }),
          {
            ...runAgainst({ scenarioRunId: "r2", referenceId: "x" }),
            metadata: null,
          },
        ],
        targetIdentities: NAMES,
      });

      expect(targets).toHaveLength(1);
      expect(targets[0]?.label).toBe("agent_gone");
    });
  });
});

describe("summaryOfTarget()", () => {
  describe("when the runs of a target are mixed", () => {
    /** @scenario "Each target column carries its own summary" */
    it("sums that target's runs alone", () => {
      const scenarioRuns = [
        runAgainst({ scenarioRunId: "r1", referenceId: "agent_dev" }),
        runAgainst({
          scenarioRunId: "r2",
          referenceId: "agent_dev",
          status: ScenarioRunStatus.FAILED,
        }),
        runAgainst({ scenarioRunId: "r3", referenceId: "agent_prod" }),
      ];
      const [dev, prod] = batchTargetsOf({
        scenarioRuns,
        targetIdentities: NAMES,
      });

      expect(runsOfTarget({ scenarioRuns, target: dev! })).toHaveLength(2);
      expect(summaryOfTarget({ scenarioRuns, target: dev! }).passRate).toBe(50);
      expect(summaryOfTarget({ scenarioRuns, target: prod! }).passRate).toBe(
        100,
      );
    });
  });
});
