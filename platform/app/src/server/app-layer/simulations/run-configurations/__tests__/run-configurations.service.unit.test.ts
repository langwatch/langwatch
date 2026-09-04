/**
 * @vitest-environment node
 *
 * The mapping from one folded row plus its plan row to one dropdown entry.
 *
 * The key is what the whole feature stands on: the dialog rebuilds the key of
 * what it currently holds to mark the matching entry, so a read that keys
 * differently marks nothing and offers the same configuration twice. The first
 * test here builds the SAME configuration both ways, once through the client
 * helper the dialog uses and once through this read, and requires one string.
 *
 * @see specs/features/agent-testing/run-configuration-history.feature
 */

import { describe, expect, it } from "vitest";
import {
  configurationKeyOf,
  sortTargets,
} from "~/components/agent-testing/run/run-configuration";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { targetKeyOf } from "~/server/suites/target-key";
import type { SuiteTarget } from "~/server/suites/types";
import type { RawRunConfigurationRow } from "../run-configurations.clickhouse.repository";
import { __testing } from "../run-configurations.service";

const { toEntry, toTarget, collapse } = __testing;

const LAST_RUN_MS = 1_800_000_000_000;

/** A plan row with no target of its own to contribute. */
const NO_PLAN_TARGETS = { byKey: new Map(), byReference: new Map() };

/** A folded row, with the fields a test does not care about filled in. */
function row(
  overrides: Partial<RawRunConfigurationRow>,
): RawRunConfigurationRow {
  const targetPairs = overrides.TargetPairs ?? ["http:agent-1"];
  return {
    SetId: getSuiteSetId("suite-1"),
    TargetPairs: targetPairs,
    TargetParameters: targetPairs.map(() => ""),
    RepeatCount: "1",
    SimulatorModel: "",
    JudgeModel: "",
    Parameters: "",
    FirstTargetParameters: "",
    // The flag saying a note was taken, never the note. Off by default.
    UsesNote: "0",
    LastRunAtMs: String(LAST_RUN_MS),
    ...overrides,
  };
}

describe("Feature: reading a configuration back off the runs", () => {
  describe("given a plan row holding the configuration of its last run", () => {
    /** @scenario "A configuration read off the runs keys the same as the plan row it came from" */
    it("keys the same as the client helper the dialog keys with", () => {
      const overrides = { region: "eu-central", seats: 12 };
      const targets: SuiteTarget[] = [
        { type: "http", referenceId: "prod-agent", runParameters: overrides },
        { type: "http", referenceId: "dev-agent" },
      ];
      const plan = {
        id: "suite-1",
        name: "Refunds",
        kind: "run_plan",
        scope: { mode: "scenarios" },
        scenarioIds: ["scenario-b", "scenario-a"],
        targets,
      };
      const runParameters = { model: "gpt-5" };

      // The dialog's own recipe, over the plan row, the way the read it
      // replaces built it.
      const fromPlanRow = configurationKeyOf({
        configuration: {
          scope: { mode: "scenarios", scenarioIds: plan.scenarioIds },
          targets: sortTargets(targets),
          repeatCount: 2,
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: null,
        },
        runParameters,
      });

      // The same configuration, as the runs recorded it. The targets arrive in
      // the order the database folded them, which is not the order the key
      // takes them in, and the run-level values were read off the plain
      // target's run.
      const entry = toEntry({
        row: row({
          TargetPairs: [`http:${targetKeyOf(targets[0]!)}`, "http:dev-agent"],
          TargetParameters: [
            JSON.stringify({ seats: 12, region: "eu-central" }),
            "",
          ],
          RepeatCount: "2",
          SimulatorModel: "openai/gpt-5-mini",
          Parameters: JSON.stringify(runParameters),
        }),
        plan,
      });

      expect(entry.key).toBe(fromPlanRow);
      expect(entry.configuration.targets).toHaveLength(2);
      expect(entry.configuration.targets).toEqual(
        expect.arrayContaining(targets),
      );
      expect(entry.runParameters).toEqual(runParameters);
    });
  });

  describe("given a row whose run-level values were read off a target with overrides", () => {
    /** @scenario "A configuration restores the parameters of each target" */
    it("takes the target's overrides back out of the run-level values", () => {
      const target: SuiteTarget = {
        type: "http",
        referenceId: "prod-agent",
        runParameters: { model: "gpt-5-mini" },
      };

      const entry = toEntry({
        row: row({
          TargetPairs: [`http:${targetKeyOf(target)}`],
          TargetParameters: [JSON.stringify(target.runParameters)],
          Parameters: JSON.stringify({ model: "gpt-5-mini", region: "eu" }),
          FirstTargetParameters: JSON.stringify(target.runParameters),
        }),
        plan: {
          id: "suite-1",
          name: "Refunds",
          kind: "run_plan",
          scope: { mode: "all" },
          scenarioIds: [],
          targets: [],
        },
      });

      expect(entry.configuration.targets).toEqual([target]);
      expect(entry.runParameters).toEqual({ region: "eu" });
    });
  });

  describe("given a plan whose prompt target carries scenario mappings", () => {
    /** @scenario "A target keeps the bindings its plan row holds" */
    it("reopens the target with those mappings", () => {
      const stored: SuiteTarget = {
        type: "prompt",
        referenceId: "prompt-1",
        scenarioMappings: {
          question: { type: "value", value: "a refund request" },
        },
      };

      const entry = toEntry({
        row: row({ TargetPairs: ["prompt:prompt-1"] }),
        plan: {
          id: "suite-1",
          name: "Refunds",
          kind: "run_plan",
          scope: { mode: "all" },
          scenarioIds: [],
          targets: [stored],
        },
      });

      expect(entry.configuration.targets).toEqual([stored]);
    });
  });

  describe("given a run whose target the plan no longer holds", () => {
    it("still reopens the target the run named", () => {
      const target = toTarget({
        pair: "workflow:removed-agent",
        parameters: "",
        planTargets: NO_PLAN_TARGETS,
      });

      expect(target).toEqual({
        type: "workflow",
        referenceId: "removed-agent",
      });
    });

    it("reopens a variant with the overrides the run recorded", () => {
      const key = targetKeyOf({
        referenceId: "removed-agent",
        runParameters: { model: "gpt-5-mini" },
      });

      const target = toTarget({
        pair: `http:${key}`,
        parameters: JSON.stringify({ model: "gpt-5-mini" }),
        planTargets: NO_PLAN_TARGETS,
      });

      expect(target).toEqual({
        type: "http",
        referenceId: "removed-agent",
        runParameters: { model: "gpt-5-mini" },
      });
    });

    it("takes the overrides from the run, not from the plan row", () => {
      const stored: SuiteTarget = {
        type: "http",
        referenceId: "prod-agent",
        runParameters: { model: "gpt-5-mini" },
        runSecretParameterNames: ["api_token"],
      };

      const target = toTarget({
        pair: "http:prod-agent",
        parameters: "",
        planTargets: {
          byKey: new Map([[targetKeyOf(stored), stored]]),
          byReference: new Map([["prod-agent", stored]]),
        },
      });

      expect(target).toEqual({
        type: "http",
        referenceId: "prod-agent",
        runSecretParameterNames: ["api_token"],
      });
    });

    it("drops a pair whose type is not one a run can name", () => {
      expect(
        toTarget({
          pair: "carrier-pigeon:x",
          parameters: "",
          planTargets: NO_PLAN_TARGETS,
        }),
      ).toBeNull();
      expect(
        toTarget({
          pair: "http:",
          parameters: "",
          planTargets: NO_PLAN_TARGETS,
        }),
      ).toBeNull();
    });
  });

  describe("given two entries of one configuration", () => {
    it("keeps the newest and orders newest first", () => {
      const plan = {
        id: "suite-1",
        name: "Refunds",
        kind: "run_plan",
        scope: { mode: "all" },
        scenarioIds: [],
        targets: [],
      };
      const older = toEntry({
        row: row({ LastRunAtMs: String(LAST_RUN_MS - 1000) }),
        plan,
      });
      const newer = toEntry({ row: row({}), plan });
      const other = toEntry({ row: row({ RepeatCount: "3" }), plan });

      const collapsed = collapse([older, newer, other]);

      expect(collapsed).toHaveLength(2);
      expect(collapsed[0]!.lastRunAt.getTime()).toBe(LAST_RUN_MS);
      expect(collapsed.filter((entry) => entry.key === newer.key)).toHaveLength(
        1,
      );
    });
  });

  describe("given a test suite plan", () => {
    it("scopes the configuration to the test suite itself", () => {
      const entry = toEntry({
        row: row({}),
        plan: {
          id: "test-suite-1",
          name: "Refunds",
          kind: "test_suite",
          scope: null,
          scenarioIds: [],
          targets: [],
        },
      });

      expect(entry.configuration.scope).toEqual({
        mode: "test_suites",
        testSuiteIds: ["test-suite-1"],
      });
    });
  });
});
