import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SuiteService,
  type SuiteRunDependencies,
  type SuiteTarget,
} from "../suite.service";
import type { SuiteRepository } from "../suite.repository";
import type { SimulationSuiteConfiguration } from "@prisma/client";

// Mock the scenario queue module
vi.mock("../../scenarios/scenario.queue", () => ({
  generateBatchRunId: vi.fn(() => "batch_test_123"),
  scheduleScenarioRun: vi.fn(() =>
    Promise.resolve({ id: "job_1", data: {} }),
  ),
}));

import {
  generateBatchRunId,
  scheduleScenarioRun,
} from "../../scenarios/scenario.queue";

const mockScheduleScenarioRun = vi.mocked(scheduleScenarioRun);
const mockGenerateBatchRunId = vi.mocked(generateBatchRunId);

function makeSuite(
  overrides: Partial<SimulationSuiteConfiguration> = {},
): SimulationSuiteConfiguration {
  return {
    id: "suite_abc123",
    projectId: "proj_1",
    name: "Test Suite",
    description: null,
    scenarioIds: ["scen_1", "scen_2", "scen_3"],
    targets: [
      { type: "http", referenceId: "agent_1" },
      { type: "prompt", referenceId: "prompt_1" },
    ] as SuiteTarget[],
    repeatCount: 1,
    labels: [],
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SuiteRunDependencies> = {}): SuiteRunDependencies {
  return {
    validateScenarioExists: vi.fn(() => Promise.resolve(true)),
    validateTargetExists: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

describe("SuiteService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateJobCount()", () => {
    describe("given 3 scenarios, 2 targets, and repeat count 1", () => {
      it("returns 6 jobs", () => {
        const result = SuiteService.calculateJobCount({
          scenarioCount: 3,
          targetCount: 2,
          repeatCount: 1,
        });
        expect(result).toBe(6);
      });
    });

    describe("given 2 scenarios, 1 target, and repeat count 3", () => {
      it("returns 6 jobs", () => {
        const result = SuiteService.calculateJobCount({
          scenarioCount: 2,
          targetCount: 1,
          repeatCount: 3,
        });
        expect(result).toBe(6);
      });
    });

    describe("given 1 scenario, 1 target, and repeat count 1", () => {
      it("returns 1 job", () => {
        const result = SuiteService.calculateJobCount({
          scenarioCount: 1,
          targetCount: 1,
          repeatCount: 1,
        });
        expect(result).toBe(1);
      });
    });
  });

  describe("run()", () => {
    let service: SuiteService;

    beforeEach(() => {
      const mockRepository: Pick<SuiteRepository, "create" | "findById" | "findAll" | "update" | "archive"> = {
        create: vi.fn(),
        findById: vi.fn(),
        findAll: vi.fn(),
        update: vi.fn(),
        archive: vi.fn(),
      };
      service = new SuiteService(mockRepository as SuiteRepository);
    });

    describe("given a suite with 3 scenarios, 2 targets, and repeat count 1", () => {
      describe("when the suite run is triggered", () => {
        it("schedules 6 jobs", async () => {
          const suite = makeSuite();
          const deps = makeDeps();

          const result = await service.run({
            suite,
            projectId: "proj_1",
            deps,
          });

          expect(result.jobCount).toBe(6);
          expect(mockScheduleScenarioRun).toHaveBeenCalledTimes(6);
        });
      });
    });

    describe("given a suite with 2 scenarios, 1 target, and repeat count 3", () => {
      describe("when the suite run is triggered", () => {
        it("schedules 6 jobs", async () => {
          const suite = makeSuite({
            scenarioIds: ["scen_1", "scen_2"],
            targets: [
              { type: "http", referenceId: "agent_1" },
            ] as SuiteTarget[],
            repeatCount: 3,
          });
          const deps = makeDeps();

          const result = await service.run({
            suite,
            projectId: "proj_1",
            deps,
          });

          expect(result.jobCount).toBe(6);
          expect(mockScheduleScenarioRun).toHaveBeenCalledTimes(6);
        });
      });
    });

    describe("given a suite with id 'suite_abc123'", () => {
      describe("when the suite run is triggered", () => {
        it("uses the suite ID as setId", async () => {
          const suite = makeSuite({ id: "suite_abc123" });
          const deps = makeDeps();

          const result = await service.run({
            suite,
            projectId: "proj_1",
            deps,
          });

          expect(result.setId).toBe("__suite__suite_abc123");
          // Verify all scheduled jobs use the same setId
          for (const call of mockScheduleScenarioRun.mock.calls) {
            expect(call[0]?.setId).toBe("__suite__suite_abc123");
          }
        });
      });
    });

    describe("given a suite with a unique batchRunId", () => {
      describe("when the suite run is triggered", () => {
        it("all jobs share the same batchRunId", async () => {
          mockGenerateBatchRunId.mockReturnValue("batch_unique_456");
          const suite = makeSuite();
          const deps = makeDeps();

          const result = await service.run({
            suite,
            projectId: "proj_1",
            deps,
          });

          expect(result.batchRunId).toBe("batch_unique_456");
          for (const call of mockScheduleScenarioRun.mock.calls) {
            expect(call[0]?.batchRunId).toBe("batch_unique_456");
          }
        });
      });
    });

    describe("given a suite references a deleted scenario", () => {
      describe("when the suite run is triggered", () => {
        it("fails with an error about invalid scenario references", async () => {
          const suite = makeSuite({
            scenarioIds: ["scen_1", "deleted-scenario"],
          });
          const deps = makeDeps({
            validateScenarioExists: vi.fn(async ({ id }) =>
              id !== "deleted-scenario",
            ),
          });

          await expect(
            service.run({ suite, projectId: "proj_1", deps }),
          ).rejects.toThrow("Invalid scenario references: deleted-scenario");
          expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given a suite references a removed target", () => {
      describe("when the suite run is triggered", () => {
        it("fails with an error about invalid target references", async () => {
          const suite = makeSuite({
            targets: [
              { type: "http", referenceId: "removed-target" },
            ] as SuiteTarget[],
          });
          const deps = makeDeps({
            validateTargetExists: vi.fn(async ({ referenceId }) =>
              referenceId !== "removed-target",
            ),
          });

          await expect(
            service.run({ suite, projectId: "proj_1", deps }),
          ).rejects.toThrow("Invalid target references: removed-target");
          expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
        });
      });
    });
  });
});
