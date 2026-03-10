import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SuiteService,
  type SuiteTarget,
} from "../suite.service";
import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
} from "../errors";
import type { SuiteRepository } from "../suite.repository";
import type { ScenarioRepository } from "../../scenarios/scenario.repository";
import type { AgentRepository } from "../../agents/agent.repository";
import type { LlmConfigRepository } from "../../prompt-config/repositories/llm-config.repository";
import type { SimulationSuite } from "@prisma/client";

// Mock the scenario queue module
const { mockRemove, mockGetJob } = vi.hoisted(() => ({
  mockRemove: vi.fn(() => Promise.resolve()),
  mockGetJob: vi.fn(() => Promise.resolve({ remove: vi.fn(() => Promise.resolve()) })),
}));

vi.mock("../../scenarios/scenario.queue", () => ({
  generateBatchRunId: vi.fn(() => "batch_test_123"),
  scheduleScenarioRun: vi.fn(() =>
    Promise.resolve({ id: "job_1", data: {} }),
  ),
  scenarioQueue: { getJob: mockGetJob },
}));

import {
  generateBatchRunId,
  scheduleScenarioRun,
} from "../../scenarios/scenario.queue";

const mockScheduleScenarioRun = vi.mocked(scheduleScenarioRun);
const mockGenerateBatchRunId = vi.mocked(generateBatchRunId);

function makeSuite(
  overrides: Partial<SimulationSuite> = {},
): SimulationSuite {
  return {
    id: "suite_abc123",
    projectId: "proj_1",
    name: "Test Suite",
    slug: "test-suite",
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

type MockSuiteRepository = {
  [K in keyof SuiteRepository]: ReturnType<typeof vi.fn>;
};

function makeMockRepository(overrides: Partial<MockSuiteRepository> = {}): MockSuiteRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySlug: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    ...overrides,
  };
}

type MockScenarioRepository = {
  findManyIncludingArchived: ReturnType<typeof vi.fn>;
  findNamesByIds: ReturnType<typeof vi.fn>;
};

type MockAgentRepository = {
  findManyIncludingArchived: ReturnType<typeof vi.fn>;
  findNamesByIds: ReturnType<typeof vi.fn>;
};

type MockLlmConfigRepository = {
  findExistingIds: ReturnType<typeof vi.fn>;
  findNamesByIds: ReturnType<typeof vi.fn>;
};

function makeMockScenarioRepository(
  overrides: Partial<MockScenarioRepository> = {},
): MockScenarioRepository {
  return {
    findManyIncludingArchived: vi.fn(({ ids }: { ids: string[] }) =>
      Promise.resolve(ids.map((id) => ({ id, archivedAt: null }))),
    ),
    findNamesByIds: vi.fn(async () => []),
    ...overrides,
  };
}

function makeMockAgentRepository(
  overrides: Partial<MockAgentRepository> = {},
): MockAgentRepository {
  return {
    findManyIncludingArchived: vi.fn(({ ids }: { ids: string[] }) =>
      Promise.resolve(ids.map((id) => ({ id, archivedAt: null }))),
    ),
    findNamesByIds: vi.fn(async () => []),
    ...overrides,
  };
}

function makeMockLlmConfigRepository(
  overrides: Partial<MockLlmConfigRepository> = {},
): MockLlmConfigRepository {
  return {
    findExistingIds: vi.fn(({ ids }: { ids: string[] }) =>
      Promise.resolve(new Set(ids)),
    ),
    findNamesByIds: vi.fn(async () => []),
    ...overrides,
  };
}

function createService(overrides?: {
  suiteRepository?: Partial<MockSuiteRepository>;
  scenarioRepository?: Partial<MockScenarioRepository>;
  agentRepository?: Partial<MockAgentRepository>;
  llmConfigRepository?: Partial<MockLlmConfigRepository>;
}) {
  const suiteRepo = makeMockRepository(overrides?.suiteRepository);
  const scenarioRepo = makeMockScenarioRepository(overrides?.scenarioRepository);
  const agentRepo = makeMockAgentRepository(overrides?.agentRepository);
  const llmConfigRepo = makeMockLlmConfigRepository(overrides?.llmConfigRepository);

  const service = new SuiteService(
    suiteRepo as unknown as SuiteRepository,
    scenarioRepo as unknown as ScenarioRepository,
    agentRepo as unknown as AgentRepository,
    llmConfigRepo as unknown as LlmConfigRepository,
  );

  return { service, suiteRepo, scenarioRepo, agentRepo, llmConfigRepo };
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
    describe("given a suite with 3 scenarios, 2 targets, and repeat count 1", () => {
      describe("when the suite run is triggered", () => {
        it("schedules 6 jobs", async () => {
          const { service } = createService();
          const suite = makeSuite();

          const result = await service.run({
            suite,
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result.jobCount).toBe(6);
          expect(mockScheduleScenarioRun).toHaveBeenCalledTimes(6);
        });
      });
    });

    describe("given a suite with 2 scenarios, 1 target, and repeat count 3", () => {
      describe("when the suite run is triggered", () => {
        it("schedules 6 jobs", async () => {
          const { service } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1", "scen_2"],
            targets: [
              { type: "http", referenceId: "agent_1" },
            ] as SuiteTarget[],
            repeatCount: 3,
          });

          const result = await service.run({
            suite,
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result.jobCount).toBe(6);
          expect(mockScheduleScenarioRun).toHaveBeenCalledTimes(6);
        });
      });
    });

    describe("given a suite with id 'suite_abc123'", () => {
      describe("when the suite run is triggered", () => {
        it("uses the suite ID as setId", async () => {
          const { service } = createService();
          const suite = makeSuite({ id: "suite_abc123" });

          const result = await service.run({
            suite,
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result.setId).toBe("__internal__suite_abc123__suite");
          for (const call of mockScheduleScenarioRun.mock.calls) {
            expect(call[0]?.setId).toBe("__internal__suite_abc123__suite");
          }
        });
      });
    });

    describe("given a suite with a unique batchRunId", () => {
      describe("when the suite run is triggered", () => {
        it("all jobs share the same batchRunId", async () => {
          mockGenerateBatchRunId.mockReturnValue("batch_unique_456");
          const { service } = createService();
          const suite = makeSuite();

          const result = await service.run({
            suite,
            projectId: "proj_1",
            organizationId: "org_1",
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

          const { service } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "http", referenceId: "agent_1" },
            ] as SuiteTarget[],
            repeatCount: 3,
          });

          await expect(
            service.run({ suite, projectId: "proj_1", organizationId: "org_1" }),
          ).rejects.toThrow("Failed to schedule suite run: 1 of 3 jobs failed to enqueue");

          expect(mockGetJob).toHaveBeenCalledTimes(2);
          expect(mockRemove).toHaveBeenCalledTimes(2);
        });
      });
    });

    describe("given a suite references a deleted scenario", () => {
      describe("when the suite run is triggered", () => {
        it("throws InvalidScenarioReferencesError with the invalid IDs", async () => {
          const { service } = createService({
            scenarioRepository: {
              findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.filter((id) => id !== "deleted-scenario").map((id) => ({ id, archivedAt: null })),
              ),
            },
          });
          const suite = makeSuite({
            scenarioIds: ["scen_1", "deleted-scenario"],
          });

          const error = await service
            .run({ suite, projectId: "proj_1", organizationId: "org_1" })
            .catch((e: unknown) => e);
          expect(error).toBeInstanceOf(InvalidScenarioReferencesError);
          expect((error as Error).message).toBe(
            "Invalid scenario references: deleted-scenario",
          );
          expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given a suite references a removed HTTP target", () => {
      describe("when the suite run is triggered", () => {
        it("throws InvalidTargetReferencesError with the invalid IDs", async () => {
          const { service } = createService({
            agentRepository: {
              findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.filter((id) => id !== "removed-target").map((id) => ({ id, archivedAt: null })),
              ),
            },
          });
          const suite = makeSuite({
            targets: [
              { type: "http", referenceId: "removed-target" },
            ] as SuiteTarget[],
          });

          const error = await service
            .run({ suite, projectId: "proj_1", organizationId: "org_1" })
            .catch((e: unknown) => e);
          expect(error).toBeInstanceOf(InvalidTargetReferencesError);
          expect((error as Error).message).toBe(
            "Invalid target references: removed-target",
          );
          expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given a suite references a removed prompt target", () => {
      describe("when the suite run is triggered", () => {
        it("throws InvalidTargetReferencesError with the invalid IDs", async () => {
          const { service } = createService({
            llmConfigRepository: {
              findExistingIds: vi.fn(async () => new Set<string>()),
            },
          });
          const suite = makeSuite({
            targets: [
              { type: "prompt", referenceId: "deleted-prompt" },
            ] as SuiteTarget[],
          });

          const error = await service
            .run({ suite, projectId: "proj_1", organizationId: "org_1" })
            .catch((e: unknown) => e);
          expect(error).toBeInstanceOf(InvalidTargetReferencesError);
          expect((error as Error).message).toBe(
            "Invalid target references: deleted-prompt",
          );
          expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given a suite with mixed active and archived scenarios", () => {
      describe("when the suite run is triggered", () => {
        it("schedules jobs only for active scenarios", async () => {
          const archivedAt = new Date();
          const { service } = createService({
            scenarioRepository: {
              findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.map((id) => ({ id, archivedAt: id === "scen_archived" ? archivedAt : null })),
              ),
            },
          });
          const suite = makeSuite({
            scenarioIds: ["scen_1", "scen_2", "scen_archived"],
            targets: [
              { type: "http", referenceId: "agent_1" },
            ] as SuiteTarget[],
          });

          const result = await service.run({
            suite, projectId: "proj_1", organizationId: "org_1",
          });

          expect(result.jobCount).toBe(2);
          expect(mockScheduleScenarioRun).toHaveBeenCalledTimes(2);
          const scheduledScenarioIds = mockScheduleScenarioRun.mock.calls.map(
            (call) => call[0]?.scenarioId,
          );
          expect(scheduledScenarioIds).toContain("scen_1");
          expect(scheduledScenarioIds).toContain("scen_2");
          expect(scheduledScenarioIds).not.toContain("scen_archived");
        });

        it("returns skipped archived scenarios in the result", async () => {
          const archivedAt = new Date();
          const { service } = createService({
            scenarioRepository: {
              findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.map((id) => ({ id, archivedAt: id === "scen_archived" ? archivedAt : null })),
              ),
            },
          });
          const suite = makeSuite({
            scenarioIds: ["scen_1", "scen_archived"],
            targets: [
              { type: "http", referenceId: "agent_1" },
            ] as SuiteTarget[],
          });

          const result = await service.run({
            suite, projectId: "proj_1", organizationId: "org_1",
          });

          expect(result.skippedArchived.scenarios).toEqual(["scen_archived"]);
          expect(result.skippedArchived.targets).toEqual([]);
        });
      });
    });

    describe("given a suite with mixed active and archived targets", () => {
      describe("when the suite run is triggered", () => {
        it("schedules jobs only against active targets", async () => {
          const archivedAt = new Date();
          const { service } = createService({
            agentRepository: {
              findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.map((id) => ({ id, archivedAt: id === "agent_archived" ? archivedAt : null })),
              ),
            },
          });
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "http", referenceId: "agent_1" },
              { type: "http", referenceId: "agent_archived" },
            ] as SuiteTarget[],
          });

          const result = await service.run({
            suite, projectId: "proj_1", organizationId: "org_1",
          });

          expect(result.jobCount).toBe(1);
          const scheduledTargetIds = mockScheduleScenarioRun.mock.calls.map(
            (call) => call[0]?.target.referenceId,
          );
          expect(scheduledTargetIds).toContain("agent_1");
          expect(scheduledTargetIds).not.toContain("agent_archived");
        });

        it("returns skipped archived targets in the result", async () => {
          const archivedAt = new Date();
          const { service } = createService({
            agentRepository: {
              findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.map((id) => ({ id, archivedAt: id === "agent_archived" ? archivedAt : null })),
              ),
            },
          });
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "http", referenceId: "agent_1" },
              { type: "http", referenceId: "agent_archived" },
            ] as SuiteTarget[],
          });

          const result = await service.run({
            suite, projectId: "proj_1", organizationId: "org_1",
          });

          expect(result.skippedArchived.targets).toEqual(["agent_archived"]);
        });
      });
    });

    describe("given all scenarios in a suite are archived", () => {
      describe("when the suite run is triggered", () => {
        it("throws AllScenariosArchivedError", async () => {
          const archivedAt = new Date();
          const { service } = createService({
            scenarioRepository: {
              findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.map((id) => ({ id, archivedAt })),
              ),
            },
          });
          const suite = makeSuite({
            scenarioIds: ["scen_archived_1", "scen_archived_2"],
          });

          await expect(
            service.run({ suite, projectId: "proj_1", organizationId: "org_1" }),
          ).rejects.toThrow(AllScenariosArchivedError);
          expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given all targets in a suite are archived", () => {
      describe("when the suite run is triggered", () => {
        it("throws AllTargetsArchivedError", async () => {
          const archivedAt = new Date();
          const { service } = createService({
            agentRepository: {
              findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.map((id) => ({ id, archivedAt })),
              ),
            },
          });
          const suite = makeSuite({
            targets: [
              { type: "http", referenceId: "agent_archived" },
            ] as SuiteTarget[],
          });

          await expect(
            service.run({ suite, projectId: "proj_1", organizationId: "org_1" }),
          ).rejects.toThrow(AllTargetsArchivedError);
          expect(mockScheduleScenarioRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given 3 scenario refs, 2 target refs, 1 scenario archived, 1 target archived, repeat count 1", () => {
      describe("when the suite run is triggered", () => {
        it("schedules 2 jobs (2 active scenarios x 1 active target)", async () => {
          const archivedAt = new Date();
          const { service } = createService({
            scenarioRepository: {
              findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.map((id) => ({ id, archivedAt: id === "scen_archived" ? archivedAt : null })),
              ),
            },
            agentRepository: {
              findManyIncludingArchived: vi.fn(async ({ ids }: { ids: string[] }) =>
                ids.map((id) => ({ id, archivedAt: id === "agent_archived" ? archivedAt : null })),
              ),
            },
          });
          const suite = makeSuite({
            scenarioIds: ["scen_1", "scen_2", "scen_archived"],
            targets: [
              { type: "http", referenceId: "agent_1" },
              { type: "http", referenceId: "agent_archived" },
            ] as SuiteTarget[],
            repeatCount: 1,
          });

          const result = await service.run({
            suite, projectId: "proj_1", organizationId: "org_1",
          });

          expect(result.jobCount).toBe(2);
          expect(result.skippedArchived).toEqual({
            scenarios: ["scen_archived"],
            targets: ["agent_archived"],
          });
        });
      });
    });

    describe("given no scenarios or targets are archived", () => {
      describe("when the suite run is triggered", () => {
        it("returns empty skippedArchived", async () => {
          const { service } = createService();
          const suite = makeSuite();

          const result = await service.run({
            suite, projectId: "proj_1", organizationId: "org_1",
          });

          expect(result.skippedArchived).toEqual({
            scenarios: [],
            targets: [],
          });
        });
      });
    });

    describe("given a suite with a target of unknown type", () => {
      describe("when the suite run is triggered", () => {
        it("throws during target parsing", async () => {
          const { service } = createService();
          const suite = makeSuite({
            targets: [
              { type: "unknown", referenceId: "ref_1" },
            ] as unknown as SuiteTarget[],
          });

          await expect(
            service.run({ suite, projectId: "proj_1", organizationId: "org_1" }),
          ).rejects.toThrow();
        });
      });
    });

    describe("given a suite with an HTTP target referencing an existing agent", () => {
      describe("when the suite run is triggered", () => {
        it("schedules jobs successfully", async () => {
          const { service, agentRepo } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "http", referenceId: "agent_1" },
            ] as SuiteTarget[],
          });

          const result = await service.run({
            suite,
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result.jobCount).toBe(1);
          expect(agentRepo.findManyIncludingArchived).toHaveBeenCalledWith({
            ids: ["agent_1"],
            projectId: "proj_1",
          });
        });
      });
    });

    describe("given a suite with a prompt target referencing an existing config", () => {
      describe("when the suite run is triggered", () => {
        it("schedules jobs successfully", async () => {
          const { service, llmConfigRepo } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "prompt", referenceId: "prompt_1" },
            ] as SuiteTarget[],
          });

          const result = await service.run({
            suite,
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(result.jobCount).toBe(1);
          expect(llmConfigRepo.findExistingIds).toHaveBeenCalledWith({
            ids: ["prompt_1"],
            projectId: "proj_1",
            organizationId: "org_1",
          });
        });
      });
    });

    describe("given a suite with a deleted prompt target", () => {
      describe("when the suite run is triggered", () => {
        it("throws InvalidTargetReferencesError (not AllTargetsArchivedError)", async () => {
          const { service } = createService({
            llmConfigRepository: {
              findExistingIds: vi.fn(async () => new Set<string>()),
            },
          });
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "prompt", referenceId: "prompt_deleted" },
            ] as SuiteTarget[],
          });

          const error = await service
            .run({ suite, projectId: "proj_1", organizationId: "org_1" })
            .catch((e: unknown) => e);
          expect(error).toBeInstanceOf(InvalidTargetReferencesError);
          expect(error).not.toBeInstanceOf(AllTargetsArchivedError);
        });
      });
    });

    describe("given a suite with mixed HTTP and prompt targets", () => {
      describe("when the suite run is triggered", () => {
        it("batches each target type into a single query", async () => {
          const { service, agentRepo, llmConfigRepo } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "http", referenceId: "agent_1" },
              { type: "http", referenceId: "agent_2" },
              { type: "prompt", referenceId: "prompt_1" },
              { type: "prompt", referenceId: "prompt_2" },
            ] as SuiteTarget[],
          });

          await service.run({
            suite,
            projectId: "proj_1",
            organizationId: "org_1",
          });

          expect(agentRepo.findManyIncludingArchived).toHaveBeenCalledTimes(1);
          expect(agentRepo.findManyIncludingArchived).toHaveBeenCalledWith({
            ids: ["agent_1", "agent_2"],
            projectId: "proj_1",
          });
          expect(llmConfigRepo.findExistingIds).toHaveBeenCalledTimes(1);
          expect(llmConfigRepo.findExistingIds).toHaveBeenCalledWith({
            ids: ["prompt_1", "prompt_2"],
            projectId: "proj_1",
            organizationId: "org_1",
          });
        });
      });
    });
  });

  describe("duplicate()", () => {
    describe("given an existing suite", () => {
      describe("when duplicate is called", () => {
        it("creates a new suite with '(copy)' appended to the name", async () => {
          const original = makeSuite({ id: "suite_1", name: "Critical Path" });
          const { service, suiteRepo } = createService({
            suiteRepository: {
              findById: vi.fn().mockResolvedValue(original),
              create: vi.fn().mockResolvedValue(
                makeSuite({ id: "suite_2", name: "Critical Path (copy)" }),
              ),
            },
          });

          const result = await service.duplicate({
            id: "suite_1",
            projectId: "proj_1",
          });

          expect(result.name).toBe("Critical Path (copy)");
          expect(suiteRepo.create).toHaveBeenCalledWith(
            expect.objectContaining({ name: "Critical Path (copy)" }),
          );
        });

        it("copies scenarioIds from the original", async () => {
          const original = makeSuite({
            id: "suite_1",
            scenarioIds: ["scen_1", "scen_2", "scen_3"],
          });
          const { service, suiteRepo } = createService({
            suiteRepository: {
              findById: vi.fn().mockResolvedValue(original),
              create: vi.fn().mockResolvedValue(makeSuite()),
            },
          });

          await service.duplicate({ id: "suite_1", projectId: "proj_1" });

          const createArg = suiteRepo.create.mock.calls[0]![0];
          expect(createArg.scenarioIds).toEqual(["scen_1", "scen_2", "scen_3"]);
        });

        it("copies targets from the original", async () => {
          const original = makeSuite({
            id: "suite_1",
            targets: [
              { type: "http", referenceId: "agent_1" },
              { type: "prompt", referenceId: "prompt_1" },
            ] as SuiteTarget[],
          });
          const { service, suiteRepo } = createService({
            suiteRepository: {
              findById: vi.fn().mockResolvedValue(original),
              create: vi.fn().mockResolvedValue(makeSuite()),
            },
          });

          await service.duplicate({ id: "suite_1", projectId: "proj_1" });

          const createArg = suiteRepo.create.mock.calls[0]![0];
          expect(createArg.targets).toEqual([
            { type: "http", referenceId: "agent_1" },
            { type: "prompt", referenceId: "prompt_1" },
          ]);
        });

        it("copies repeatCount from the original", async () => {
          const original = makeSuite({ id: "suite_1", repeatCount: 5 });
          const { service, suiteRepo } = createService({
            suiteRepository: {
              findById: vi.fn().mockResolvedValue(original),
              create: vi.fn().mockResolvedValue(makeSuite()),
            },
          });

          await service.duplicate({ id: "suite_1", projectId: "proj_1" });

          const createArg = suiteRepo.create.mock.calls[0]![0];
          expect(createArg.repeatCount).toBe(5);
        });

        it("copies labels from the original", async () => {
          const original = makeSuite({ id: "suite_1", labels: ["regression", "smoke"] });
          const { service, suiteRepo } = createService({
            suiteRepository: {
              findById: vi.fn().mockResolvedValue(original),
              create: vi.fn().mockResolvedValue(makeSuite()),
            },
          });

          await service.duplicate({ id: "suite_1", projectId: "proj_1" });

          const createArg = suiteRepo.create.mock.calls[0]![0];
          expect(createArg.labels).toEqual(["regression", "smoke"]);
        });
      });
    });

    describe("given a non-existent suite", () => {
      describe("when duplicate is called", () => {
        it("throws an error", async () => {
          const { service } = createService({
            suiteRepository: {
              findById: vi.fn().mockResolvedValue(null),
            },
          });

          await expect(
            service.duplicate({ id: "suite_missing", projectId: "proj_1" }),
          ).rejects.toThrow("Suite not found");
        });
      });
    });
  });

  describe("archive()", () => {
    describe("given an existing suite", () => {
      describe("when archive is called", () => {
        it("archives the suite via the repository", async () => {
          const archived = makeSuite({ archivedAt: new Date() });
          const { service, suiteRepo } = createService({
            suiteRepository: {
              archive: vi.fn().mockResolvedValue(archived),
            },
          });

          const result = await service.archive({
            id: "suite_1",
            projectId: "proj_1",
          });

          expect(result).toBe(archived);
          expect(suiteRepo.archive).toHaveBeenCalledWith({
            id: "suite_1",
            projectId: "proj_1",
          });
        });
      });
    });

    describe("given a non-existent suite", () => {
      describe("when archive is called", () => {
        it("returns null", async () => {
          const { service } = createService({
            suiteRepository: {
              archive: vi.fn().mockResolvedValue(null),
            },
          });

          const result = await service.archive({
            id: "suite_missing",
            projectId: "proj_1",
          });

          expect(result).toBeNull();
        });
      });
    });
  });

  describe("resolveArchivedNames()", () => {
    describe("given archived scenario and target IDs", () => {
      it("returns name maps from repository lookups", async () => {
        const { service } = createService({
          scenarioRepository: {
            findNamesByIds: vi.fn(async () => [
              { id: "scen_1", name: "My Scenario" },
            ]),
          },
          agentRepository: {
            findNamesByIds: vi.fn(async () => [
              { id: "agent_1", name: "My Agent" },
            ]),
          },
        });

        const result = await service.resolveArchivedNames({
          scenarioIds: ["scen_1"],
          targets: [{ type: "http", referenceId: "agent_1" }],
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result.scenarios).toEqual({ scen_1: "My Scenario" });
        expect(result.targets).toEqual({ agent_1: "My Agent" });
      });
    });

    describe("given prompt targets", () => {
      it("returns name maps from llmConfigRepository", async () => {
        const { service } = createService({
          llmConfigRepository: {
            findNamesByIds: vi.fn(async () => [
              { id: "prompt_1", name: "My Prompt" },
            ]),
          },
        });

        const result = await service.resolveArchivedNames({
          scenarioIds: [],
          targets: [{ type: "prompt", referenceId: "prompt_1" }],
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result.targets).toEqual({ prompt_1: "My Prompt" });
      });
    });

    describe("given empty inputs", () => {
      it("returns empty maps without querying repositories", async () => {
        const { service, scenarioRepo, agentRepo, llmConfigRepo } =
          createService();

        const result = await service.resolveArchivedNames({
          scenarioIds: [],
          targets: [],
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result.scenarios).toEqual({});
        expect(result.targets).toEqual({});
        expect(scenarioRepo.findNamesByIds).not.toHaveBeenCalled();
        expect(agentRepo.findNamesByIds).not.toHaveBeenCalled();
        expect(llmConfigRepo.findNamesByIds).not.toHaveBeenCalled();
      });
    });

    describe("given mixed HTTP and prompt targets", () => {
      it("queries agents and prompts separately", async () => {
        const { service, agentRepo, llmConfigRepo } = createService({
          agentRepository: {
            findNamesByIds: vi.fn(async () => [
              { id: "agent_1", name: "Agent One" },
            ]),
          },
          llmConfigRepository: {
            findNamesByIds: vi.fn(async () => [
              { id: "prompt_1", name: "Prompt One" },
            ]),
          },
        });

        const result = await service.resolveArchivedNames({
          scenarioIds: [],
          targets: [
            { type: "http", referenceId: "agent_1" },
            { type: "prompt", referenceId: "prompt_1" },
          ],
          projectId: "proj_1",
          organizationId: "org_1",
        });

        expect(result.targets).toEqual({
          agent_1: "Agent One",
          prompt_1: "Prompt One",
        });
        expect(agentRepo.findNamesByIds).toHaveBeenCalledWith({
          ids: ["agent_1"],
          projectId: "proj_1",
        });
        expect(llmConfigRepo.findNamesByIds).toHaveBeenCalledWith({
          ids: ["prompt_1"],
          projectId: "proj_1",
          organizationId: "org_1",
        });
      });
    });
  });
});
