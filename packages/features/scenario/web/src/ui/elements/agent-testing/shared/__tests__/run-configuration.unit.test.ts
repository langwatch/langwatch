/**
 * The identity of a run configuration, and the words that tell two of them
 * apart in the run name dropdown.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { describe, expect, it } from "vitest";
import {
  configurationKeyOf,
  configurationsForScope,
  deriveRunName,
  describeConfigurations,
  normaliseRunScope,
  type RunConfiguration,
  type RunConfigurationEntry,
  scopeKeyOf,
  sortedTargetLabels,
  sortTargets,
} from "../../../../sections/agent-testing/run/run-configuration";

const TARGET_LABELS = new Map([
  ["agent_dev", "dev-agent"],
  ["agent_prod", "prod-agent"],
]);

function configuration(overrides: Partial<RunConfiguration> = {}): RunConfiguration {
  return {
    scope: { mode: "test_suites", testSuiteIds: ["test_suite_refunds"] },
    targets: [{ type: "http", referenceId: "agent_dev" }],
    repeatCount: 1,
    simulatorModel: null,
    judgeModel: null,
    ...overrides,
  };
}

function entry(overrides: Partial<RunConfigurationEntry> = {}): RunConfigurationEntry {
  const config = overrides.configuration ?? configuration();
  const runParameters = overrides.runParameters ?? {};
  return {
    key: configurationKeyOf({ configuration: config, runParameters }),
    planId: "plan_1",
    planName: "Refunds dev-agent",
    configuration: config,
    runParameters,
    lastRunAt: new Date("2026-08-01T10:00:00Z"),
    ...overrides,
  };
}

describe("deriveRunName", () => {
  describe("when the run has one target", () => {
    it("reads the scope and the target", () => {
      expect(deriveRunName({ scopeLabel: "Refunds", targetLabels: ["dev-agent"] })).toBe(
        "Refunds dev-agent",
      );
    });
  });

  describe("when the run compares two targets", () => {
    it("joins them with vs", () => {
      expect(
        deriveRunName({
          scopeLabel: "Refunds",
          targetLabels: ["dev-agent", "prod-agent"],
        }),
      ).toBe("Refunds dev-agent vs prod-agent");
    });
  });

  describe("when nothing is chosen to run against", () => {
    it("names the scope alone", () => {
      expect(deriveRunName({ scopeLabel: "Refunds", targetLabels: [] })).toBe("Refunds");
    });
  });
});

describe("configurationKeyOf", () => {
  describe("when two runs differ only in the order the targets were picked", () => {
    it("gives them one identity", () => {
      const left = configurationKeyOf({
        configuration: configuration({
          targets: [
            { type: "http", referenceId: "agent_dev" },
            { type: "http", referenceId: "agent_prod" },
          ],
        }),
        runParameters: {},
      });
      const right = configurationKeyOf({
        configuration: configuration({
          targets: [
            { type: "http", referenceId: "agent_prod" },
            { type: "http", referenceId: "agent_dev" },
          ],
        }),
        runParameters: {},
      });

      expect(left).toBe(right);
    });
  });

  describe("when two runs of one plan used different parameters", () => {
    it("gives them separate identities", () => {
      const plain = configurationKeyOf({
        configuration: configuration(),
        runParameters: {},
      });
      const overridden = configurationKeyOf({
        configuration: configuration(),
        runParameters: { locale: "de" },
      });

      expect(plain).not.toBe(overridden);
    });
  });
});

describe("scopeKeyOf", () => {
  describe("when two hand-picked scopes hold different scenarios", () => {
    it("keeps them apart", () => {
      expect(scopeKeyOf({ mode: "scenarios", scenarioIds: ["a"] })).not.toBe(
        scopeKeyOf({ mode: "scenarios", scenarioIds: ["b"] }),
      );
    });
  });
});

describe("normaliseRunScope", () => {
  describe("when every test suite of the project is ticked", () => {
    it("reads as all scenarios", () => {
      expect(
        normaliseRunScope({
          scope: { mode: "test_suites", testSuiteIds: ["one", "two"] },
          allTestSuiteIds: ["one", "two"],
        }),
      ).toEqual({ mode: "all" });
    });
  });

  describe("when one test suite of two is ticked", () => {
    it("stays a suite scope", () => {
      expect(
        normaliseRunScope({
          scope: { mode: "test_suites", testSuiteIds: ["one"] },
          allTestSuiteIds: ["one", "two"],
        }),
      ).toEqual({ mode: "test_suites", testSuiteIds: ["one"] });
    });
  });
});

describe("describeConfigurations", () => {
  describe("when two entries share a plan name and differ in repeat count", () => {
    const once = entry({ planId: "plan_1" });
    const thrice = entry({
      planId: "plan_2",
      configuration: configuration({ repeatCount: 3 }),
    });
    const entries = [once, thrice];

    /** @scenario "Two configurations of one plan name are told apart by what differs" */
    it("lists both", () => {
      const described = describeConfigurations({
        entries,
        targetLabels: TARGET_LABELS,
      });

      expect(described.size).toBe(2);
    });

    /** @scenario "Two configurations of one plan name are told apart by what differs" */
    it("names the repeat count on the entry that carries one", () => {
      const described = describeConfigurations({
        entries,
        targetLabels: TARGET_LABELS,
      });

      expect(described.get(thrice.key)).toContain("3 runs each");
    });

    it("still reads the targets on both", () => {
      const described = describeConfigurations({
        entries,
        targetLabels: TARGET_LABELS,
      });

      expect(described.get(once.key)).toContain("dev-agent");
      expect(described.get(thrice.key)).toContain("dev-agent");
    });
  });

  describe("when two entries share a plan name and differ in parameters", () => {
    it("names the parameters that differ", () => {
      const plain = entry({ planId: "plan_1" });
      const german = entry({
        planId: "plan_2",
        runParameters: { locale: "de" },
      });
      const described = describeConfigurations({
        entries: [plain, german],
        targetLabels: TARGET_LABELS,
      });

      expect(described.get(german.key)).toContain("locale=de");
    });
  });

  describe("when an entry is alone under its name", () => {
    it("reads its targets and no more", () => {
      const only = entry();
      const described = describeConfigurations({
        entries: [only],
        targetLabels: TARGET_LABELS,
      });

      expect(described.get(only.key)).toBe("dev-agent");
    });
  });
});

describe("configurationsForScope", () => {
  describe("when the entries cover more than one scope", () => {
    it("keeps only the ones of the scope asked for", () => {
      const refunds = entry();
      const other = entry({
        planId: "plan_2",
        configuration: configuration({
          scope: { mode: "test_suites", testSuiteIds: ["test_suite_other"] },
        }),
      });

      const found = configurationsForScope({
        entries: [refunds, other],
        scope: { mode: "test_suites", testSuiteIds: ["test_suite_refunds"] },
      });

      expect(found.map((found) => found.planId)).toEqual(["plan_1"]);
    });
  });

  describe("when one configuration ran many times", () => {
    it("collapses onto the newest of them", () => {
      const older = entry({
        planId: "plan_1",
        lastRunAt: new Date("2026-08-01T10:00:00Z"),
      });
      const newer = entry({
        planId: "plan_1",
        lastRunAt: new Date("2026-08-20T10:00:00Z"),
      });

      const found = configurationsForScope({
        entries: [older, newer],
        scope: { mode: "test_suites", testSuiteIds: ["test_suite_refunds"] },
      });

      expect(found).toHaveLength(1);
      expect(found[0]?.lastRunAt).toEqual(new Date("2026-08-20T10:00:00Z"));
    });
  });

  describe("when several configurations exist", () => {
    it("reads them newest first", () => {
      const older = entry({
        planId: "plan_1",
        lastRunAt: new Date("2026-08-01T10:00:00Z"),
      });
      const newer = entry({
        planId: "plan_2",
        configuration: configuration({ repeatCount: 3 }),
        lastRunAt: new Date("2026-08-20T10:00:00Z"),
      });

      const found = configurationsForScope({
        entries: [older, newer],
        scope: { mode: "test_suites", testSuiteIds: ["test_suite_refunds"] },
      });

      expect(found.map((entry) => entry.planId)).toEqual(["plan_2", "plan_1"]);
    });
  });
});

describe("sortedTargetLabels", () => {
  const byReferenceId = (target: { referenceId: string }) => target.referenceId;

  describe("when a comparison holds two different agents", () => {
    /** @scenario "A target of a comparison is named after its agent" */
    it("names each after its agent", () => {
      expect(
        sortedTargetLabels({
          targets: [
            { type: "http", referenceId: "agent_dev" },
            { type: "http", referenceId: "agent_prod" },
          ],
          targetLabels: TARGET_LABELS,
          fallbackLabel: byReferenceId,
        }),
      ).toEqual(["dev-agent", "prod-agent"]);
    });
  });

  describe("when the same agent appears twice with different parameters", () => {
    /** @scenario "The same agent twice is named with the parameters that differ" */
    it("names each with the parameters that differ, and leaves a shared value out", () => {
      expect(
        deriveRunName({
          scopeLabel: "Refunds",
          targetLabels: sortedTargetLabels({
            targets: [
              {
                type: "http",
                referenceId: "agent_dev",
                runParameters: { locale: "de", model: "gpt-5" },
              },
              {
                type: "http",
                referenceId: "agent_dev",
                runParameters: { locale: "de", model: "gpt-5-mini" },
              },
            ],
            targetLabels: TARGET_LABELS,
            fallbackLabel: byReferenceId,
          }),
        }),
      ).toBe("Refunds dev-agent · model=gpt-5 vs dev-agent · model=gpt-5-mini");
    });

    /** @scenario "A repeated agent that carries none of the differing parameters keeps its bare name" */
    it("keeps the bare name for the target that carries none of the differing parameters", () => {
      expect(
        sortedTargetLabels({
          targets: [
            {
              type: "http",
              referenceId: "agent_dev",
              runParameters: { locale: "de" },
            },
            {
              type: "http",
              referenceId: "agent_dev",
              runParameters: { locale: "de", plan: "pro" },
            },
          ],
          targetLabels: TARGET_LABELS,
          fallbackLabel: byReferenceId,
        }),
      ).toEqual(["dev-agent", "dev-agent · plan=pro"]);
    });

    it("sorts the keys inside a label", () => {
      expect(
        sortedTargetLabels({
          targets: [
            {
              type: "http",
              referenceId: "agent_dev",
              runParameters: { plan: "pro", locale: "de" },
            },
            { type: "http", referenceId: "agent_dev" },
          ],
          targetLabels: TARGET_LABELS,
          fallbackLabel: byReferenceId,
        }),
      ).toEqual(["dev-agent", "dev-agent · locale=de, plan=pro"]);
    });
  });

  describe("when the targets were picked in another order", () => {
    /** @scenario "Targets are sorted by agent and then by parameters" */
    it("reads them by agent and then by parameters", () => {
      expect(
        sortedTargetLabels({
          targets: [
            { type: "http", referenceId: "agent_prod" },
            {
              type: "http",
              referenceId: "agent_dev",
              runParameters: { model: "b" },
            },
            {
              type: "http",
              referenceId: "agent_dev",
              runParameters: { model: "a" },
            },
          ],
          targetLabels: TARGET_LABELS,
          fallbackLabel: byReferenceId,
        }),
      ).toEqual(["dev-agent · model=a", "dev-agent · model=b", "prod-agent"]);
    });
  });

  describe("when the project no longer offers the agent", () => {
    it("reads the fallback", () => {
      expect(
        sortedTargetLabels({
          targets: [{ type: "http", referenceId: "agent_gone" }],
          targetLabels: TARGET_LABELS,
          fallbackLabel: () => "a removed agent",
        }),
      ).toEqual(["a removed agent"]);
    });
  });
});

describe("sortTargets", () => {
  describe("when the same agent appears twice with different parameters", () => {
    /** @scenario "Targets are sorted by agent and then by parameters" */
    it("keeps both and orders them by their parameters", () => {
      const sorted = sortTargets([
        {
          type: "http",
          referenceId: "agent_dev",
          runParameters: { model: "b" },
        },
        {
          type: "http",
          referenceId: "agent_dev",
          runParameters: { model: "a" },
        },
      ]);

      expect(sorted.map((target) => target.runParameters?.model)).toEqual(["a", "b"]);
    });
  });
});
