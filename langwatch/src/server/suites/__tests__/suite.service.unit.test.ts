import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SuiteService,
  type SuiteRunDependencies,
  type SuiteTarget,
} from "../suite.service";
import type { SuiteRepository } from "../suite.repository";
import type { SimulationSuiteConfiguration } from "@prisma/client";

type MockJob = {
  data: { setId: string };
  getState: () => Promise<string>;
};

// Mock the scenario queue module
const { mockRemove, mockGetJob, mockGetJobs } = vi.hoisted(() => ({
  mockRemove: vi.fn(() => Promise.resolve()),
  mockGetJob: vi.fn(() => Promise.resolve({ remove: vi.fn(() => Promise.resolve()) })),
  mockGetJobs: vi.fn((): Promise<MockJob[]> => Promise.resolve([])),
}));

vi.mock("../../scenarios/scenario.queue", () => ({
  generateBatchRunId: vi.fn(() => "batch_test_123"),
  scheduleScenarioRun: vi.fn(() =>
    Promise.resolve({ id: "job_1", data: {} }),
  ),
  scenarioQueue: { getJob: mockGetJob, getJobs: mockGetJobs },
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

    describe("given some jobs fail to enqueue", () => {
      describe("when the suite run is triggered", () => {
        it("rolls back all enqueued jobs and throws", async () => {
          let callCount = 0;
          mockScheduleScenarioRun.mockImplementation(() => {
            callCount++;
            if (callCount === 2) {
              return Promise.reject(new Error("Redis connection lost"));
            }
            return Promise.resolve({ id: `job_${callCount}`, data: {} } as never);
          });

          mockGetJob.mockImplementation(() =>
            Promise.resolve({ remove: mockRemove }),
          );

          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "http", referenceId: "agent_1" },
            ] as SuiteTarget[],
            repeatCount: 3,
          });
          const deps = makeDeps();

          await expect(
            service.run({ suite, projectId: "proj_1", deps }),
          ).rejects.toThrow("Failed to schedule suite run: 1 of 3 jobs failed to enqueue");

          // Verify rollback: remove called for each of the 2 successfully enqueued jobs
          expect(mockGetJob).toHaveBeenCalledTimes(2);
          expect(mockRemove).toHaveBeenCalledTimes(2);
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

  describe("getQueueStatus()", () => {
    describe("given a suite has 3 waiting and 1 active job in the queue", () => {
      describe("when the queue status is queried", () => {
        it("returns 3 waiting and 1 active", async () => {
          const suiteId = "suite_abc123";
          const setId = "__suite__suite_abc123";

          mockGetJobs.mockResolvedValue([
            { data: { setId }, getState: () => Promise.resolve("waiting") },
            { data: { setId }, getState: () => Promise.resolve("waiting") },
            { data: { setId }, getState: () => Promise.resolve("waiting") },
            { data: { setId }, getState: () => Promise.resolve("active") },
            { data: { setId: "other_set" }, getState: () => Promise.resolve("waiting") },
          ]);

          const result = await SuiteService.getQueueStatus({ suiteId });

          expect(result).toEqual({
            waiting: 3,
            active: 1,
          });
        });
      });
    });

    describe("given a suite has no jobs in the queue", () => {
      describe("when the queue status is queried", () => {
        it("returns 0 waiting and 0 active", async () => {
          mockGetJobs.mockResolvedValue([]);

          const result = await SuiteService.getQueueStatus({ suiteId: "suite_empty" });

          expect(result).toEqual({
            waiting: 0,
            active: 0,
          });
        });
      });
    });

    describe("given the queue has jobs for multiple suites", () => {
      describe("when the queue status is queried for one suite", () => {
        it("only counts jobs matching the suite setId", async () => {
          const targetSetId = "__suite__suite_target";
          const otherSetId = "__suite__suite_other";

          mockGetJobs.mockResolvedValue([
            { data: { setId: targetSetId }, getState: () => Promise.resolve("waiting") },
            { data: { setId: otherSetId }, getState: () => Promise.resolve("waiting") },
            { data: { setId: targetSetId }, getState: () => Promise.resolve("active") },
            { data: { setId: otherSetId }, getState: () => Promise.resolve("active") },
          ]);

          const result = await SuiteService.getQueueStatus({ suiteId: "suite_target" });

          expect(result).toEqual({
            waiting: 1,
            active: 1,
          });
        });
      });
    });
  });
});
