/**
 * @vitest-environment node
 *
 * Which interface every address the platform hands out opens in, per project.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: vi.fn() },
}));

vi.mock("~/server/db", () => ({
  prisma: { project: { findUnique: vi.fn() } },
}));

import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import {
  batchRunPath,
  readTestingInterface,
  scenarioEditorPath,
  scenarioRunPath,
  scenarioSetPath,
  suitePlatformPath,
} from "../platform-path";

const isEnabled = vi.mocked(featureFlagService.isEnabled);
const findProject = vi.mocked(prisma.project.findUnique);

const pathFor = (kind: "run_plan" | "test_suite") =>
  suitePlatformPath({
    projectId: "project_1",
    organizationId: "org_1",
    slug: "refunds",
    kind,
  });

describe("suitePlatformPath", () => {
  beforeEach(() => {
    isEnabled.mockReset();
  });

  describe("given the project reads Agent Testing", () => {
    beforeEach(() => {
      isEnabled.mockResolvedValue(true);
    });

    it("opens a run plan on its results page", async () => {
      await expect(pathFor("run_plan")).resolves.toBe(
        "/agent-testing/results/refunds",
      );
    });

    it("opens a test suite on its own page", async () => {
      await expect(pathFor("test_suite")).resolves.toBe(
        "/agent-testing/suites/refunds",
      );
    });

    it("names the project and the organization in the flag read", async () => {
      await pathFor("run_plan");

      expect(isEnabled).toHaveBeenCalledWith(
        "release_ui_agent_testing_v2_enabled",
        expect.objectContaining({
          projectId: "project_1",
          organizationId: "org_1",
        }),
      );
    });
  });

  describe("given the project reads the Simulations pages", () => {
    beforeEach(() => {
      isEnabled.mockResolvedValue(false);
    });

    it("opens a run plan on its simulations page", async () => {
      await expect(pathFor("run_plan")).resolves.toBe(
        "/simulations/run-plans/refunds",
      );
    });

    it("opens a test suite on the simulations index", async () => {
      await expect(pathFor("test_suite")).resolves.toBe("/simulations");
    });
  });

  describe("when the flag read fails", () => {
    it("answers the interface every project can open", async () => {
      isEnabled.mockRejectedValue(new Error("flag store unreachable"));

      await expect(pathFor("run_plan")).resolves.toBe(
        "/simulations/run-plans/refunds",
      );
    });
  });
});

describe("readTestingInterface", () => {
  beforeEach(() => {
    isEnabled.mockReset();
    findProject.mockReset();
  });

  describe("given a caller that does not hold the organization", () => {
    it("reads it from the project, so a release rule on the organization applies", async () => {
      findProject.mockResolvedValue({
        team: { organizationId: "org_9" },
      } as never);
      isEnabled.mockResolvedValue(true);

      await expect(
        readTestingInterface({ projectId: "project_lookup_1" }),
      ).resolves.toBe("agent_testing");

      expect(findProject).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "project_lookup_1" } }),
      );
      expect(isEnabled).toHaveBeenCalledWith(
        "release_ui_agent_testing_v2_enabled",
        expect.objectContaining({
          projectId: "project_lookup_1",
          organizationId: "org_9",
        }),
      );
    });

    it("reads the organization once per project", async () => {
      findProject.mockResolvedValue({
        team: { organizationId: "org_9" },
      } as never);
      isEnabled.mockResolvedValue(true);

      await readTestingInterface({ projectId: "project_lookup_2" });
      await readTestingInterface({ projectId: "project_lookup_2" });

      expect(findProject).toHaveBeenCalledTimes(1);
    });

    it("answers the Simulations pages for a project it cannot find", async () => {
      findProject.mockResolvedValue(null);

      await expect(
        readTestingInterface({ projectId: "project_missing" }),
      ).resolves.toBe("simulations");
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });
});

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
