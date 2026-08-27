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
import type { SuiteTarget } from "~/server/suites/types";
import type { RawRunConfigurationRow } from "../run-configurations.clickhouse.repository";
import { __testing } from "../run-configurations.service";

const { toEntry, parseRunParameters, toTarget, collapse } = __testing;

const LAST_RUN_MS = 1_800_000_000_000;

/** A folded row, with the fields a test does not care about filled in. */
function row(
  overrides: Partial<RawRunConfigurationRow>,
): RawRunConfigurationRow {
  return {
    SetId: getSuiteSetId("suite-1"),
    TargetPairs: ["http:agent-1"],
    RepeatCount: "1",
    SimulatorModel: "",
    JudgeModel: "",
    Parameters: "",
    LastRunAtMs: String(LAST_RUN_MS),
    ...overrides,
  };
}

describe("Feature: reading a configuration back off the runs", () => {
  describe("given a plan row holding the configuration of its last run", () => {
    /** @scenario "A configuration read off the runs keys the same as the plan row it came from" */
    it("keys the same as the client helper the dialog keys with", () => {
      const targets: SuiteTarget[] = [
        {
          type: "http",
          referenceId: "prod-agent",
          runParameters: { region: "eu-central", seats: 12 },
        },
        {
          type: "http",
          referenceId: "dev-agent",
          runParameters: { region: "eu-central", seats: 12 },
        },
      ];
      const plan = {
        id: "suite-1",
        name: "Refunds",
        kind: "custom",
        scope: { mode: "cases" },
        scenarioIds: ["scenario-b", "scenario-a"],
        targets,
      };

      // The dialog's own recipe, over the plan row, the way the read it
      // replaces built it: the sorted-first target carries the overrides.
      const fromPlanRow = configurationKeyOf({
        configuration: {
          scope: { mode: "cases", caseIds: plan.scenarioIds },
          targets: sortTargets(targets),
          repeatCount: 2,
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: null,
        },
        runParameters: sortTargets(targets)[0]!.runParameters ?? {},
      });

      // The same configuration, as the runs recorded it. The targets arrive in
      // the order the database folded them, which is not the order the key
      // takes them in.
      const entry = toEntry({
        row: row({
          TargetPairs: ["http:prod-agent", "http:dev-agent"],
          RepeatCount: "2",
          SimulatorModel: "openai/gpt-5-mini",
          Parameters: JSON.stringify({ seats: 12, region: "eu-central" }),
        }),
        plan,
      });

      expect(entry.key).toBe(fromPlanRow);
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
          kind: "custom",
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
        planTargetsByReference: new Map(),
      });

      expect(target).toEqual({
        type: "workflow",
        referenceId: "removed-agent",
      });
    });

    it("drops a pair whose type is not one a run can name", () => {
      expect(
        toTarget({
          pair: "carrier-pigeon:x",
          planTargetsByReference: new Map(),
        }),
      ).toBeNull();
      expect(
        toTarget({ pair: "http:", planTargetsByReference: new Map() }),
      ).toBeNull();
    });
  });

  describe("given the raw parameters a run stored", () => {
    it("reads back strings, numbers and booleans", () => {
      expect(
        parseRunParameters(
          JSON.stringify({ region: "eu-central", seats: 12, trial: false }),
        ),
      ).toEqual({ region: "eu-central", seats: 12, trial: false });
    });

    it("reads a run that resolved none as no parameters", () => {
      expect(parseRunParameters("")).toEqual({});
    });

    it("drops a value the current shape cannot carry", () => {
      expect(
        parseRunParameters(JSON.stringify({ region: "eu", extra: { a: 1 } })),
      ).toEqual({ region: "eu" });
    });
  });

  describe("given two entries of one configuration", () => {
    it("keeps the newest and orders newest first", () => {
      const plan = {
        id: "suite-1",
        name: "Refunds",
        kind: "custom",
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

  describe("given a folder plan", () => {
    it("scopes the configuration to the folder itself", () => {
      const entry = toEntry({
        row: row({}),
        plan: {
          id: "folder-1",
          name: "Refunds",
          kind: "folder",
          scope: null,
          scenarioIds: [],
          targets: [],
        },
      });

      expect(entry.configuration.scope).toEqual({
        mode: "folders",
        folderIds: ["folder-1"],
      });
    });
  });
});
