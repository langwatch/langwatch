/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";
import type { ScenarioService, ScenarioTestSuite } from "@langwatch/scenario-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import { SuiteScopeNotAllowedError, type SuiteService } from "@langwatch/suite-contract";
import { SuiteApp } from "../suite.app";

function testSuite(overrides: Partial<ScenarioTestSuite> = {}): ScenarioTestSuite {
  return {
    id: "test_suite_1",
    projectId: "project_1",
    name: "Refunds",
    slug: "refunds",
    description: null,
    scenarioIds: [],
    targets: [],
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    kind: "test_suite",
    scope: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildApp(overrides: { scenarios?: Partial<ScenarioService> } = {}) {
  const updateTestSuite = vi.fn().mockResolvedValue(testSuite());
  const scenarios = {
    tryGetTestSuite: vi.fn().mockResolvedValue(testSuite()),
    updateTestSuite,
    ...overrides.scenarios,
  } as unknown as ScenarioService;

  const app = SuiteApp.create({
    suites: {} as SuiteService,
    scenarios,
    projects: {} as ProjectService,
    simulations: {} as SimulationService,
  });
  return { app, updateTestSuite };
}

describe("SuiteApp.update", () => {
  describe("given a test suite", () => {
    /** @scenario "The suite editor refuses to broaden a test suite into a code-owned suite" */
    it("refuses a scope or scenarioIds write on a test suite", async () => {
      const { app, updateTestSuite } = buildApp();

      await expect(
        app.update({
          id: "test_suite_1",
          projectId: "project_1",
          scope: { mode: "all" },
        }),
      ).rejects.toBeInstanceOf(SuiteScopeNotAllowedError);

      await expect(
        app.update({
          id: "test_suite_1",
          projectId: "project_1",
          scenarioIds: ["scen_x"],
        }),
      ).rejects.toMatchObject({ code: "validation_error" });

      expect(updateTestSuite).not.toHaveBeenCalled();
    });
  });
});
