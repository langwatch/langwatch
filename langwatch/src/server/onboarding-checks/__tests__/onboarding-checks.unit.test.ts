/**
 * @vitest-environment node
 *
 * Unit tests for the simulations onboarding check.
 *
 * Guards the retarget of getSimulationsCount onto the app-layer
 * `getApp().simulations.runs.getScenarioSetsData` (ES removal): the method
 * swallows all errors and returns 0, so a mis-wire would silently report
 * "no simulations" forever with the suite green.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetScenarioSetsData,
  mockFindUniqueProject,
  mockFindFirstPrompt,
  mockFindFirstModelProvider,
} = vi.hoisted(() => ({
  mockGetScenarioSetsData: vi.fn(),
  mockFindUniqueProject: vi.fn(),
  mockFindFirstPrompt: vi.fn(),
  mockFindFirstModelProvider: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: mockFindUniqueProject },
    llmPromptConfig: { findFirst: mockFindFirstPrompt },
    modelProvider: { findFirst: mockFindFirstModelProvider },
  },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    simulations: {
      runs: { getScenarioSetsData: mockGetScenarioSetsData },
    },
  }),
}));

import { OnboardingChecksService } from "../onboarding-checks.service";

describe("OnboardingChecksService", () => {
  let service: OnboardingChecksService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUniqueProject.mockResolvedValue(null);
    mockFindFirstPrompt.mockResolvedValue(null);
    mockFindFirstModelProvider.mockResolvedValue(null);
    service = new OnboardingChecksService();
  });

  describe("getCheckStatus", () => {
    describe("given the project has at least one scenario set", () => {
      it("reports simulations as complete", async () => {
        mockGetScenarioSetsData.mockResolvedValue([
          { scenarioSetId: "set-1", scenarioCount: 3, lastRunAt: 1000 },
        ]);

        const result = await service.getCheckStatus("project-1");

        expect(mockGetScenarioSetsData).toHaveBeenCalledWith({
          projectId: "project-1",
        });
        expect(result.simulations).toBe(1);
      });
    });

    describe("given the project has no scenario sets", () => {
      it("reports simulations as incomplete", async () => {
        mockGetScenarioSetsData.mockResolvedValue([]);

        const result = await service.getCheckStatus("project-1");

        expect(result.simulations).toBe(0);
      });
    });

    describe("given the simulations lookup throws (ClickHouse unavailable)", () => {
      it("reports simulations as incomplete instead of failing the whole check", async () => {
        mockGetScenarioSetsData.mockRejectedValue(
          new Error("ClickHouse unavailable"),
        );

        const result = await service.getCheckStatus("project-1");

        expect(result.simulations).toBe(0);
      });
    });

    describe("given the project has online evaluations", () => {
      const projectWith = (overrides: Record<string, unknown>) => ({
        workflows: [],
        customGraphs: [],
        datasets: [],
        checks: [],
        triggers: [],
        teamId: "team-1",
        team: { organizationId: "organization-1", members: [] },
        firstMessage: false,
        integrated: false,
        ...overrides,
      });

      it("marks the online evaluation step complete from a monitor", async () => {
        mockFindUniqueProject.mockResolvedValue(
          projectWith({ checks: [{ id: "monitor-1" }] }),
        );
        mockGetScenarioSetsData.mockResolvedValue([]);

        const result = await service.getCheckStatus("project-1");

        expect(result.onlineEvaluations).toBe(1);
      });

      it("does not complete the online evaluation step from an experiment", async () => {
        mockFindUniqueProject.mockResolvedValue(
          projectWith({ experiments: [{ id: "experiment-1" }] }),
        );
        mockGetScenarioSetsData.mockResolvedValue([]);

        const result = await service.getCheckStatus("project-1");

        expect(result.onlineEvaluations).toBe(0);
      });
    });
  });
});
