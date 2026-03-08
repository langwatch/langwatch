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
import type { SuiteRunService } from "../../app-layer/suites/suite-run.service";
import type { SimulationSuite } from "@prisma/client";

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

function createMockSuiteRunService() {
  const startRun = vi.fn().mockImplementation(async (params: Record<string, unknown>) => ({
    batchRunId: "batch_test_123",
    setId: `__internal__${String(params.suiteId)}__suite`,
    jobCount: (params.activeScenarioIds as string[]).length
      * (params.activeTargets as unknown[]).length
      * (params.repeatCount as number),
    skippedArchived: params.skippedArchived,
  }));
  return { startRun } as unknown as SuiteRunService & { startRun: ReturnType<typeof vi.fn> };
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
  const suiteRunService = createMockSuiteRunService();

  const service = new SuiteService(
    suiteRepo as unknown as SuiteRepository,
    scenarioRepo as unknown as ScenarioRepository,
    agentRepo as unknown as AgentRepository,
    llmConfigRepo as unknown as LlmConfigRepository,
    suiteRunService,
  );

  return { service, suiteRepo, scenarioRepo, agentRepo, llmConfigRepo, suiteRunService };
}

const RUN_DEFAULTS = {
  projectId: "proj_1",
  organizationId: "org_1",
  idempotencyKey: "test-key",
} as const;

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
        it("delegates to suiteRunService with 3 active scenarios and 2 active targets", async () => {
          const { service, suiteRunService } = createService();
          const suite = makeSuite();

          const result = await service.run({
            suite, ...RUN_DEFAULTS,
          });

          expect(result.jobCount).toBe(6);
          expect(suiteRunService.startRun).toHaveBeenCalledWith(
            expect.objectContaining({
              activeScenarioIds: ["scen_1", "scen_2", "scen_3"],
              activeTargets: [
                { type: "http", referenceId: "agent_1" },
                { type: "prompt", referenceId: "prompt_1" },
              ],
              repeatCount: 1,
            }),
          );
        });
      });
    });

    describe("given a suite with 2 scenarios, 1 target, and repeat count 3", () => {
      describe("when the suite run is triggered", () => {
        it("delegates with correct repeat count", async () => {
          const { service, suiteRunService } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1", "scen_2"],
            targets: [
              { type: "http", referenceId: "agent_1" },
            ] as SuiteTarget[],
            repeatCount: 3,
          });

          const result = await service.run({
            suite, ...RUN_DEFAULTS,
          });

          expect(result.jobCount).toBe(6);
          expect(suiteRunService.startRun).toHaveBeenCalledWith(
            expect.objectContaining({ repeatCount: 3 }),
          );
        });
      });
    });

    describe("given a suite references a deleted scenario", () => {
      describe("when the suite run is triggered", () => {
        it("throws InvalidScenarioReferencesError before reaching suiteRunService", async () => {
          const { service, suiteRunService } = createService({
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
            .run({ suite, ...RUN_DEFAULTS })
            .catch((e: unknown) => e);
          expect(error).toBeInstanceOf(InvalidScenarioReferencesError);
          expect((error as Error).message).toBe(
            "Invalid scenario references: deleted-scenario",
          );
          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given a suite references a removed HTTP target", () => {
      describe("when the suite run is triggered", () => {
        it("throws InvalidTargetReferencesError before reaching suiteRunService", async () => {
          const { service, suiteRunService } = createService({
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
            .run({ suite, ...RUN_DEFAULTS })
            .catch((e: unknown) => e);
          expect(error).toBeInstanceOf(InvalidTargetReferencesError);
          expect((error as Error).message).toBe(
            "Invalid target references: removed-target",
          );
          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given a suite references a removed prompt target", () => {
      describe("when the suite run is triggered", () => {
        it("throws InvalidTargetReferencesError before reaching suiteRunService", async () => {
          const { service, suiteRunService } = createService({
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
            .run({ suite, ...RUN_DEFAULTS })
            .catch((e: unknown) => e);
          expect(error).toBeInstanceOf(InvalidTargetReferencesError);
          expect((error as Error).message).toBe(
            "Invalid target references: deleted-prompt",
          );
          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given a suite with mixed active and archived scenarios", () => {
      describe("when the suite run is triggered", () => {
        it("passes only active scenario IDs to suiteRunService", async () => {
          const archivedAt = new Date();
          const { service, suiteRunService } = createService({
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
            suite, ...RUN_DEFAULTS,
          });

          expect(result.jobCount).toBe(2);
          expect(suiteRunService.startRun).toHaveBeenCalledWith(
            expect.objectContaining({
              activeScenarioIds: ["scen_1", "scen_2"],
              skippedArchived: { scenarios: ["scen_archived"], targets: [] },
            }),
          );
        });
      });
    });

    describe("given a suite with mixed active and archived targets", () => {
      describe("when the suite run is triggered", () => {
        it("passes only active targets to suiteRunService", async () => {
          const archivedAt = new Date();
          const { service, suiteRunService } = createService({
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
            suite, ...RUN_DEFAULTS,
          });

          expect(result.jobCount).toBe(1);
          expect(suiteRunService.startRun).toHaveBeenCalledWith(
            expect.objectContaining({
              activeTargets: [{ type: "http", referenceId: "agent_1" }],
              skippedArchived: { scenarios: [], targets: ["agent_archived"] },
            }),
          );
        });
      });
    });

    describe("given all scenarios in a suite are archived", () => {
      describe("when the suite run is triggered", () => {
        it("throws AllScenariosArchivedError", async () => {
          const archivedAt = new Date();
          const { service, suiteRunService } = createService({
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
            service.run({ suite, ...RUN_DEFAULTS }),
          ).rejects.toThrow(AllScenariosArchivedError);
          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given all targets in a suite are archived", () => {
      describe("when the suite run is triggered", () => {
        it("throws AllTargetsArchivedError", async () => {
          const archivedAt = new Date();
          const { service, suiteRunService } = createService({
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
            service.run({ suite, ...RUN_DEFAULTS }),
          ).rejects.toThrow(AllTargetsArchivedError);
          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given 3 scenario refs, 2 target refs, 1 scenario archived, 1 target archived", () => {
      describe("when the suite run is triggered", () => {
        it("passes only active refs and reports skipped archived", async () => {
          const archivedAt = new Date();
          const { service, suiteRunService } = createService({
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
            suite, ...RUN_DEFAULTS,
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
          const { service, suiteRunService } = createService();
          const suite = makeSuite();

          const result = await service.run({
            suite, ...RUN_DEFAULTS,
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
          const { service, suiteRunService } = createService();
          const suite = makeSuite({
            targets: [
              { type: "unknown", referenceId: "ref_1" },
            ] as unknown as SuiteTarget[],
          });

          await expect(
            service.run({ suite, ...RUN_DEFAULTS }),
          ).rejects.toThrow();
        });
      });
    });

    describe("given a suite with an HTTP target referencing an existing agent", () => {
      describe("when the suite run is triggered", () => {
        it("resolves via agentRepository and delegates", async () => {
          const { service, agentRepo, suiteRunService } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "http", referenceId: "agent_1" },
            ] as SuiteTarget[],
          });

          const result = await service.run({
            suite, ...RUN_DEFAULTS,
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
        it("resolves via llmConfigRepository and delegates", async () => {
          const { service, llmConfigRepo, suiteRunService } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "prompt", referenceId: "prompt_1" },
            ] as SuiteTarget[],
          });

          const result = await service.run({
            suite, ...RUN_DEFAULTS,
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
          const { service, suiteRunService } = createService({
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
            .run({ suite, ...RUN_DEFAULTS })
            .catch((e: unknown) => e);
          expect(error).toBeInstanceOf(InvalidTargetReferencesError);
          expect(error).not.toBeInstanceOf(AllTargetsArchivedError);
        });
      });
    });

    describe("given a suite with mixed HTTP and prompt targets", () => {
      describe("when the suite run is triggered", () => {
        it("batches each target type into a single query", async () => {
          const { service, agentRepo, llmConfigRepo, suiteRunService } = createService();
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
            suite, ...RUN_DEFAULTS,
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

    describe("given idempotencyKey is provided", () => {
      describe("when the suite run is triggered", () => {
        it("passes idempotencyKey through to suiteRunService", async () => {
          const { service, suiteRunService } = createService();
          const suite = makeSuite();

          await service.run({
            suite, projectId: "proj_1", organizationId: "org_1",
            idempotencyKey: "user-provided-key",
          });

          expect(suiteRunService.startRun).toHaveBeenCalledWith(
            expect.objectContaining({ idempotencyKey: "user-provided-key" }),
          );
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
