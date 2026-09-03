import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, SimulationSuite } from "~/generated/prisma/client";
import type { AgentRepository } from "../../agents/agent.repository";
import type { SuiteRunService } from "../../app-layer/suites/suite-run.service";
import type { LlmConfigRepository } from "../../prompt-config/repositories/llm-config.repository";
import type { ScenarioRepository } from "../../scenarios/scenario.repository";
import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
} from "../errors";
import type { SuiteRepository } from "../suite.repository";
import { SuiteService, type SuiteTarget } from "../suite.service";
import { targetKeyOf } from "../target-key";

function makeSuite(overrides: Partial<SimulationSuite> = {}): SimulationSuite {
  return {
    id: "suite_abc123",
    projectId: "proj_1",
    name: "Test Suite",
    slug: "test-suite",
    kind: "run_plan",
    scope: null,
    description: null,
    scenarioIds: ["scen_1", "scen_2", "scen_3"],
    targets: [
      { type: "http", referenceId: "agent_1" },
      { type: "prompt", referenceId: "prompt_1" },
    ] as SuiteTarget[],
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    fields: null,
    evaluators: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

type MockSuiteRepository = {
  [K in keyof SuiteRepository]: ReturnType<typeof vi.fn>;
};

function makeMockRepository(
  overrides: Partial<MockSuiteRepository> = {},
): MockSuiteRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findBySlug: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    findSlugsByPrefix: vi.fn().mockResolvedValue([]),
    findFirstByLabel: vi.fn().mockResolvedValue(null),
    findNamesByIds: vi.fn(async () => []),
    findManyByIdsIncludingArchived: vi.fn(async () => []),
    // No plan answers to a name unless a scenario says one does.
    findPlanByName: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    archive: vi.fn(),
    ...overrides,
  };
}

type MockScenarioRepository = {
  findManyIncludingArchived: ReturnType<typeof vi.fn>;
  findNamesByIds: ReturnType<typeof vi.fn>;
  findActiveNamesByIds: ReturnType<typeof vi.fn>;
  findRunConfigByIds: ReturnType<typeof vi.fn>;
  findTestSuiteIdsByIds: ReturnType<typeof vi.fn>;
  findManyByTestSuite: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
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
    findActiveNamesByIds: vi.fn(async () => []),
    findRunConfigByIds: vi.fn(async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({
        id,
        name: id,
        situation: "A customer asks for help",
        criteria: ["Answers the question"],
        parameters: null,
        version: 1,
      })),
    ),
    findTestSuiteIdsByIds: vi.fn(async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({ id, testSuiteId: null })),
    ),
    findManyByTestSuite: vi.fn(async () => []),
    findAll: vi.fn(async () => []),
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
  const startRun = vi
    .fn()
    .mockImplementation(async (params: Record<string, unknown>) => ({
      batchRunId: "batch_test_123",
      setId: `__internal__${String(params.suiteId)}__suite`,
      jobCount:
        (params.activeScenarioIds as string[]).length *
        (params.activeTargets as unknown[]).length *
        (params.repeatCount as number),
      skippedArchived: params.skippedArchived,
    }));
  return { startRun } as unknown as SuiteRunService & {
    startRun: ReturnType<typeof vi.fn>;
  };
}

function createService(overrides?: {
  suiteRepository?: Partial<MockSuiteRepository>;
  scenarioRepository?: Partial<MockScenarioRepository>;
  agentRepository?: Partial<MockAgentRepository>;
  llmConfigRepository?: Partial<MockLlmConfigRepository>;
  /** Only the paths that resolve a rule against the project read this. */
  prisma?: Record<string, unknown>;
}) {
  const suiteRepo = makeMockRepository(overrides?.suiteRepository);
  const scenarioRepo = makeMockScenarioRepository(
    overrides?.scenarioRepository,
  );
  const agentRepo = makeMockAgentRepository(overrides?.agentRepository);
  const llmConfigRepo = makeMockLlmConfigRepository(
    overrides?.llmConfigRepository,
  );
  const suiteRunService = createMockSuiteRunService();

  // Resolving a run plan by name takes an advisory lock, so the stub answers
  // `$transaction` and the `$executeRaw` that takes the lock. There is no
  // database in this lane: the body runs at once and the transaction client
  // is the stub itself, so a read under `tx` sees the same fixtures as a read
  // that names the client directly. What the lock holds apart is proven by
  // the datastore-lane test, `plan-identity.integration.test.ts`.
  const prismaStub: Record<string, unknown> = {
    $executeRaw: vi.fn(async () => 0),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prismaStub),
    ...(overrides?.prisma ?? {}),
  };

  const service = new SuiteService(
    suiteRepo as unknown as SuiteRepository,
    scenarioRepo as unknown as ScenarioRepository,
    agentRepo as unknown as AgentRepository,
    llmConfigRepo as unknown as LlmConfigRepository,
    suiteRunService,
    prismaStub as unknown as PrismaClient,
  );

  return {
    service,
    suiteRepo,
    scenarioRepo,
    agentRepo,
    llmConfigRepo,
    suiteRunService,
  };
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
      /** @scenario "Suite run respects repeat count" */
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
        /** @scenario "Suite run succeeds when all scenarios exist" */
        /** @scenario "Suite run succeeds when HTTP target agent exists" */
        it("delegates to suiteRunService with 3 active scenarios and 2 active targets", async () => {
          const { service, suiteRunService } = createService();
          const suite = makeSuite();

          const result = await service.run({
            suite,
            ...RUN_DEFAULTS,
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
            suite,
            ...RUN_DEFAULTS,
          });

          expect(result.jobCount).toBe(6);
          expect(suiteRunService.startRun).toHaveBeenCalledWith(
            expect.objectContaining({ repeatCount: 3 }),
          );
        });
      });
    });

    describe("given the run supplies parameter values", () => {
      const declaring = (parameters: unknown) => ({
        findRunConfigByIds: vi.fn(async ({ ids }: { ids: string[] }) =>
          ids.map((id) => ({
            id,
            name: id,
            situation: "A {{ params.account_tier }} customer asks for help",
            criteria: ["Answers the question"],
            parameters,
            version: 1,
          })),
        ),
      });

      describe("when every supplied name is declared", () => {
        it("hands the resolved values to suiteRunService per scenario", async () => {
          const { service, suiteRunService } = createService({
            scenarioRepository: declaring([
              { name: "account_tier", defaultValue: "gold" },
              { name: "region", defaultValue: "eu-central" },
            ]),
          });

          await service.run({
            suite: makeSuite({ scenarioIds: ["scen_1"] }),
            ...RUN_DEFAULTS,
            parameters: { account_tier: "platinum" },
          });

          const { parametersByTargetKey } = suiteRunService.startRun.mock
            .calls[0]?.[0] as {
            parametersByTargetKey: Map<
              string,
              Map<string, Record<string, unknown>>
            >;
          };
          expect(parametersByTargetKey.get("agent_1")?.get("scen_1")).toEqual({
            account_tier: "platinum",
            region: "eu-central",
          });
          expect(parametersByTargetKey.get("prompt_1")?.get("scen_1")).toEqual({
            account_tier: "platinum",
            region: "eu-central",
          });
        });
      });

      describe("when a target carries overrides of its own", () => {
        const twoTargets = [
          { type: "http", referenceId: "agent_1" },
          {
            type: "http",
            referenceId: "agent_1",
            runParameters: { account_tier: "silver" },
          },
        ] as SuiteTarget[];

        /** @scenario "Each target receives its own parameters merged over the run parameters" */
        it("merges them over the run's values, the target winning", async () => {
          const { service, suiteRunService } = createService({
            scenarioRepository: declaring([
              { name: "account_tier", defaultValue: "gold" },
              { name: "region", defaultValue: "eu-central" },
            ]),
          });

          await service.run({
            suite: makeSuite({ scenarioIds: ["scen_1"], targets: twoTargets }),
            ...RUN_DEFAULTS,
            parameters: { region: "us-east" },
          });

          const { parametersByTargetKey, activeTargets } = suiteRunService
            .startRun.mock.calls[0]?.[0] as {
            parametersByTargetKey: Map<
              string,
              Map<string, Record<string, unknown>>
            >;
            activeTargets: SuiteTarget[];
          };
          const variantKey = targetKeyOf(twoTargets[1]!);
          expect(parametersByTargetKey.get("agent_1")?.get("scen_1")).toEqual({
            account_tier: "gold",
            region: "us-east",
          });
          expect(parametersByTargetKey.get(variantKey)?.get("scen_1")).toEqual({
            account_tier: "silver",
            region: "us-east",
          });
          // The overrides travel with the target, so the stamp can name them.
          expect(activeTargets[1]?.runParameters).toEqual({
            account_tier: "silver",
          });
        });

        /** @scenario "A target override no scenario in the run declares is refused" */
        it("rejects an override no scenario declares before anything is scheduled", async () => {
          const { service, suiteRunService } = createService({
            scenarioRepository: declaring([
              { name: "account_tier", defaultValue: "gold" },
            ]),
          });

          await expect(
            service.run({
              suite: makeSuite({
                scenarioIds: ["scen_1"],
                targets: [
                  { type: "http", referenceId: "agent_1" },
                  {
                    type: "http",
                    referenceId: "agent_1",
                    runParameters: { seats: 12 },
                  },
                ] as SuiteTarget[],
              }),
              ...RUN_DEFAULTS,
            }),
          ).rejects.toMatchObject({ code: "scenario_parameter_unknown" });

          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });

        /** @scenario "A target override naming a secret parameter is refused" */
        it("rejects an override that names a secret parameter", async () => {
          const { service, suiteRunService } = createService({
            scenarioRepository: declaring([
              { name: "account_tier", defaultValue: "gold" },
              { name: "api_token", secret: true },
            ]),
          });

          await expect(
            service.run({
              suite: makeSuite({
                scenarioIds: ["scen_1"],
                targets: [
                  {
                    type: "http",
                    referenceId: "agent_1",
                    runParameters: { api_token: "tok-live-1" },
                  },
                ] as SuiteTarget[],
              }),
              ...RUN_DEFAULTS,
              parameters: { api_token: "tok-live-1" },
            }),
          ).rejects.toMatchObject({
            code: "validation_error",
            meta: { fieldErrors: { targets: [expect.any(String)] } },
          });

          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });

        /** @scenario "Two identical targets are refused" */
        it("rejects two targets with one key before anything is read", async () => {
          const { service, suiteRunService, scenarioRepo } = createService();

          await expect(
            service.run({
              suite: makeSuite({
                scenarioIds: ["scen_1"],
                targets: [
                  {
                    type: "http",
                    referenceId: "agent_1",
                    runParameters: { account_tier: "silver" },
                  },
                  {
                    type: "http",
                    referenceId: "agent_1",
                    runParameters: { account_tier: "silver" },
                  },
                ] as SuiteTarget[],
              }),
              ...RUN_DEFAULTS,
            }),
          ).rejects.toMatchObject({
            code: "validation_error",
            meta: { fieldErrors: { targets: [expect.any(String)] } },
          });

          expect(scenarioRepo.findManyIncludingArchived).not.toHaveBeenCalled();
          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });

        /** @scenario "Two targets that differ only by a typed default are refused" */
        it("rejects two targets that differ only by a typed default", async () => {
          const { service, suiteRunService } = createService({
            scenarioRepository: declaring([
              { name: "account_tier", defaultValue: "gold" },
            ]),
          });

          await expect(
            service.run({
              suite: makeSuite({
                scenarioIds: ["scen_1"],
                targets: [
                  { type: "http", referenceId: "agent_1" },
                  {
                    type: "http",
                    referenceId: "agent_1",
                    runParameters: { account_tier: "gold" },
                  },
                ] as SuiteTarget[],
              }),
              ...RUN_DEFAULTS,
            }),
          ).rejects.toMatchObject({
            code: "validation_error",
            meta: { fieldErrors: { targets: [expect.any(String)] } },
          });

          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });

      describe("when a supplied name is declared by no scenario in the run", () => {
        it("rejects with scenario_parameter_unknown before anything is scheduled", async () => {
          const { service, suiteRunService } = createService({
            scenarioRepository: declaring([
              { name: "account_tier", defaultValue: "gold" },
            ]),
          });

          await expect(
            service.run({
              suite: makeSuite({ scenarioIds: ["scen_1"] }),
              ...RUN_DEFAULTS,
              parameters: { regoin: "eu-central" },
            }),
          ).rejects.toMatchObject({ code: "scenario_parameter_unknown" });

          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });

      describe("when a scenario declares one of them secret", () => {
        const declaringSecret = {
          findRunConfigByIds: vi.fn(async ({ ids }: { ids: string[] }) =>
            ids.map((id) => ({
              id,
              name: id,
              situation: "A {{ params.account_tier }} customer asks for help",
              criteria: ["Answers the question"],
              parameters: [
                { name: "account_tier", defaultValue: "gold" },
                { name: "api_token", secret: true },
              ],
            })),
          ),
        };

        // The store boundary itself is covered where it is crossed, in
        // suite-run-parameters.integration.test.ts. What this pins is the
        // handoff: the value leaves the suite service encrypted, and the plain
        // record it travels beside never holds it.
        it("hands the secret to suiteRunService encrypted and out of the plain values", async () => {
          const { service, suiteRunService } = createService({
            scenarioRepository: declaringSecret,
          });

          await service.run({
            suite: makeSuite({ scenarioIds: ["scen_1"] }),
            ...RUN_DEFAULTS,
            parameters: { api_token: "tok-live-1" },
          });

          const { parametersByTargetKey, secretParametersByScenarioId } =
            suiteRunService.startRun.mock.calls[0]?.[0] as {
              parametersByTargetKey: Map<
                string,
                Map<string, Record<string, unknown>>
              >;
              secretParametersByScenarioId: Map<string, Record<string, string>>;
            };

          expect(parametersByTargetKey.get("agent_1")?.get("scen_1")).toEqual({
            account_tier: "gold",
          });
          const stamped = secretParametersByScenarioId.get("scen_1");
          expect(Object.keys(stamped!)).toEqual(["api_token"]);
          expect(stamped!.api_token).not.toContain("tok-live-1");
        });

        /** @scenario "A secret parameter value must be supplied when the run starts" */
        it("rejects the run when the secret has no value", async () => {
          const { service, suiteRunService } = createService({
            scenarioRepository: declaringSecret,
          });

          await expect(
            service.run({
              suite: makeSuite({ scenarioIds: ["scen_1"] }),
              ...RUN_DEFAULTS,
            }),
          ).rejects.toMatchObject({
            code: "scenario_secret_parameter_missing",
          });

          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });

      describe("when the scenario reads a parameter nothing resolves", () => {
        it("rejects with scenario_parameter_missing before anything is scheduled", async () => {
          const { service, suiteRunService } = createService({
            scenarioRepository: declaring([{ name: "account_tier" }]),
          });

          await expect(
            service.run({
              suite: makeSuite({ scenarioIds: ["scen_1"] }),
              ...RUN_DEFAULTS,
            }),
          ).rejects.toMatchObject({ code: "scenario_parameter_missing" });

          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given a suite references a deleted scenario", () => {
      describe("when the suite run is triggered", () => {
        /** @scenario Deleted scenarios still cause validation errors */
        /** @scenario "Suite run fails when a scenario does not exist" */
        it("throws InvalidScenarioReferencesError before reaching suiteRunService", async () => {
          const { service, suiteRunService } = createService({
            scenarioRepository: {
              findManyIncludingArchived: vi.fn(
                async ({ ids }: { ids: string[] }) =>
                  ids
                    .filter((id) => id !== "deleted-scenario")
                    .map((id) => ({ id, archivedAt: null })),
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
        /** @scenario "Suite run fails when HTTP target agent does not exist" */
        it("throws InvalidTargetReferencesError before reaching suiteRunService", async () => {
          const { service, suiteRunService } = createService({
            agentRepository: {
              findManyIncludingArchived: vi.fn(
                async ({ ids }: { ids: string[] }) =>
                  ids
                    .filter((id) => id !== "removed-target")
                    .map((id) => ({ id, archivedAt: null })),
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
        /** @scenario "Run validation rejects prompt from unrelated project without org scope" */
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
        /** @scenario Suite run excludes archived scenarios from job scheduling */
        /** @scenario Filters out archived scenarios from a reference list */
        it("passes only active scenario IDs to suiteRunService", async () => {
          const archivedAt = new Date();
          const { service, suiteRunService } = createService({
            scenarioRepository: {
              findManyIncludingArchived: vi.fn(
                async ({ ids }: { ids: string[] }) =>
                  ids.map((id) => ({
                    id,
                    archivedAt: id === "scen_archived" ? archivedAt : null,
                  })),
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
            suite,
            ...RUN_DEFAULTS,
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
        /** @scenario Suite run excludes archived targets from job scheduling */
        /** @scenario Filters out archived targets from a reference list */
        it("passes only active targets to suiteRunService", async () => {
          const archivedAt = new Date();
          const { service, suiteRunService } = createService({
            agentRepository: {
              findManyIncludingArchived: vi.fn(
                async ({ ids }: { ids: string[] }) =>
                  ids.map((id) => ({
                    id,
                    archivedAt: id === "agent_archived" ? archivedAt : null,
                  })),
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
            suite,
            ...RUN_DEFAULTS,
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

    describe("given a connected target unseen for thirty one days", () => {
      describe("when the suite run is triggered", () => {
        /** @scenario "A connected agent unseen for thirty days is refused as a run target" */
        it("skips it the way it skips an archived target", async () => {
          const unseenAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
          const { service, suiteRunService } = createService({
            agentRepository: {
              findManyIncludingArchived: vi.fn(
                async ({ ids }: { ids: string[] }) =>
                  ids.map((id) => ({
                    id,
                    type: id === "agent_unseen" ? "connected" : "http",
                    archivedAt: null,
                    lastSeenAt: id === "agent_unseen" ? unseenAt : null,
                  })),
              ),
            },
          });
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "http", referenceId: "agent_1" },
              { type: "connected", referenceId: "agent_unseen" },
            ] as SuiteTarget[],
          });

          const result = await service.run({ suite, ...RUN_DEFAULTS });

          expect(result.jobCount).toBe(1);
          expect(suiteRunService.startRun).toHaveBeenCalledWith(
            expect.objectContaining({
              activeTargets: [{ type: "http", referenceId: "agent_1" }],
              skippedArchived: { scenarios: [], targets: ["agent_unseen"] },
            }),
          );
        });
      });
    });

    describe("given all scenarios in a suite are archived", () => {
      describe("when the suite run is triggered", () => {
        /** @scenario Suite run fails when all scenarios are archived */
        it("throws AllScenariosArchivedError", async () => {
          const archivedAt = new Date();
          const { service, suiteRunService } = createService({
            scenarioRepository: {
              findManyIncludingArchived: vi.fn(
                async ({ ids }: { ids: string[] }) =>
                  ids.map((id) => ({ id, archivedAt })),
              ),
            },
          });
          const suite = makeSuite({
            scenarioIds: ["scen_archived_1", "scen_archived_2"],
          });

          await expect(service.run({ suite, ...RUN_DEFAULTS })).rejects.toThrow(
            AllScenariosArchivedError,
          );
          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given all targets in a suite are archived", () => {
      describe("when the suite run is triggered", () => {
        /** @scenario Suite run fails when all targets are archived */
        it("throws AllTargetsArchivedError", async () => {
          const archivedAt = new Date();
          const { service, suiteRunService } = createService({
            agentRepository: {
              findManyIncludingArchived: vi.fn(
                async ({ ids }: { ids: string[] }) =>
                  ids.map((id) => ({ id, archivedAt })),
              ),
            },
          });
          const suite = makeSuite({
            targets: [
              { type: "http", referenceId: "agent_archived" },
            ] as SuiteTarget[],
          });

          await expect(service.run({ suite, ...RUN_DEFAULTS })).rejects.toThrow(
            AllTargetsArchivedError,
          );
          expect(suiteRunService.startRun).not.toHaveBeenCalled();
        });
      });
    });

    describe("given 3 scenario refs, 2 target refs, 1 scenario archived, 1 target archived", () => {
      describe("when the suite run is triggered", () => {
        /** @scenario Suite run reports skipped archived scenarios */
        /** @scenario Suite run reports skipped archived targets */
        /** @scenario Job count reflects only active scenarios and targets */
        it("passes only active refs and reports skipped archived", async () => {
          const archivedAt = new Date();
          const { service } = createService({
            scenarioRepository: {
              findManyIncludingArchived: vi.fn(
                async ({ ids }: { ids: string[] }) =>
                  ids.map((id) => ({
                    id,
                    archivedAt: id === "scen_archived" ? archivedAt : null,
                  })),
              ),
            },
            agentRepository: {
              findManyIncludingArchived: vi.fn(
                async ({ ids }: { ids: string[] }) =>
                  ids.map((id) => ({
                    id,
                    archivedAt: id === "agent_archived" ? archivedAt : null,
                  })),
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
            suite,
            ...RUN_DEFAULTS,
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
            suite,
            ...RUN_DEFAULTS,
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
            service.run({ suite, ...RUN_DEFAULTS }),
          ).rejects.toThrow();
        });
      });
    });

    describe("given a suite with an HTTP target referencing an existing agent", () => {
      describe("when the suite run is triggered", () => {
        it("resolves via agentRepository and delegates", async () => {
          const { service, agentRepo } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "http", referenceId: "agent_1" },
            ] as SuiteTarget[],
          });

          const result = await service.run({
            suite,
            ...RUN_DEFAULTS,
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
        /** @scenario "Suite run succeeds when prompt config exists in project" */
        /** @scenario "Suite run succeeds when prompt config is org-scoped" */
        it("resolves via llmConfigRepository and delegates", async () => {
          const { service, llmConfigRepo } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: [
              { type: "prompt", referenceId: "prompt_1" },
            ] as SuiteTarget[],
          });

          const result = await service.run({
            suite,
            ...RUN_DEFAULTS,
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
        /** @scenario "Suite run fails when prompt config is soft-deleted" */
        /** @scenario "Suite run fails when prompt config belongs to another organization" */
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
            ...RUN_DEFAULTS,
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

    describe("given a mix of http and code agent targets", () => {
      const mixedTargets = [
        { type: "http", referenceId: "agent_1" },
        { type: "code", referenceId: "agent_2" },
      ] as SuiteTarget[];

      describe("when the suite run is triggered", () => {
        it("batches both into the agent repository call", async () => {
          const { service, agentRepo } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: mixedTargets,
          });

          await service.run({
            suite,
            ...RUN_DEFAULTS,
          });

          expect(agentRepo.findManyIncludingArchived).toHaveBeenCalledWith({
            ids: ["agent_1", "agent_2"],
            projectId: "proj_1",
          });
        });

        it("does not invoke the llm config repository", async () => {
          const { service, llmConfigRepo } = createService();
          const suite = makeSuite({
            scenarioIds: ["scen_1"],
            targets: mixedTargets,
          });

          await service.run({
            suite,
            ...RUN_DEFAULTS,
          });

          expect(llmConfigRepo.findExistingIds).not.toHaveBeenCalled();
        });
      });
    });

    describe("given idempotencyKey is provided", () => {
      describe("when the suite run is triggered", () => {
        it("passes idempotencyKey through to suiteRunService", async () => {
          const { service, suiteRunService } = createService();
          const suite = makeSuite();

          await service.run({
            suite,
            projectId: "proj_1",
            organizationId: "org_1",
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
              create: vi
                .fn()
                .mockResolvedValue(
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
          const original = makeSuite({
            id: "suite_1",
            labels: ["regression", "smoke"],
          });
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

  describe("getAll()", () => {
    describe("when the caller names no kind", () => {
      /** @scenario "A caller that names no kind of suite gets run plans only" */
      it("asks the repository for custom suites only", async () => {
        const { service, suiteRepo } = createService();
        suiteRepo.findAll.mockResolvedValue([makeSuite()]);

        await service.getAll({ projectId: "proj_1" });

        expect(suiteRepo.findAll).toHaveBeenCalledWith({
          projectId: "proj_1",
          kinds: ["run_plan"],
        });
      });
    });

    describe("when the caller names kinds explicitly", () => {
      it("passes them through", async () => {
        const { service, suiteRepo } = createService();

        await service.getAll({
          projectId: "proj_1",
          kinds: ["test_suite", "run_plan"],
        });

        expect(suiteRepo.findAll).toHaveBeenCalledWith({
          projectId: "proj_1",
          kinds: ["test_suite", "run_plan"],
        });
      });
    });

    describe("when the caller asks for archived rows", () => {
      /** @scenario "Archived run plans are listed only when the caller asks for them" */
      it("asks for them only when told to", async () => {
        const { service, suiteRepo } = createService();

        await service.getAll({ projectId: "proj_1" });
        expect(suiteRepo.findAll).toHaveBeenCalledWith({
          projectId: "proj_1",
          kinds: ["run_plan"],
        });

        await service.getAll({ projectId: "proj_1", includeArchived: true });
        expect(suiteRepo.findAll).toHaveBeenLastCalledWith({
          projectId: "proj_1",
          kinds: ["run_plan"],
          includeArchived: true,
        });
      });
    });
  });

  describe("getTestSuiteDetail()", () => {
    describe("given a test suite holding active and archived scenarios", () => {
      /** @scenario "A test suite reads back with the scenarios filed in it" */
      it("names every active scenario in the order the test suite holds them", async () => {
        const { service, suiteRepo } = createService({
          scenarioRepository: {
            findActiveNamesByIds: vi.fn().mockResolvedValue([
              { id: "scen_2", name: "Second" },
              { id: "scen_1", name: "First" },
            ]),
          },
        });
        suiteRepo.findById.mockResolvedValue(
          makeSuite({
            id: "test_suite_1",
            kind: "test_suite",
            name: "Refunds",
            scenarioIds: ["scen_1", "scen_2", "scen_archived"],
          }),
        );

        const detail = await service.getTestSuiteDetail({
          projectId: "proj_1",
          testSuiteId: "test_suite_1",
        });

        expect(detail.name).toBe("Refunds");
        expect(detail.scenarios).toEqual([
          { id: "scen_1", name: "First" },
          { id: "scen_2", name: "Second" },
        ]);
      });
    });

    describe("given the id names a run plan", () => {
      it("refuses with suite_not_found", async () => {
        const { service, suiteRepo } = createService();
        suiteRepo.findById.mockResolvedValue(makeSuite({ kind: "run_plan" }));

        await expect(
          service.getTestSuiteDetail({
            projectId: "proj_1",
            testSuiteId: "suite_abc123",
          }),
        ).rejects.toMatchObject({ code: "suite_not_found" });
      });
    });
  });

  describe("createTestSuite()", () => {
    describe("when the name is only spaces", () => {
      /** @scenario "A test suite created with a blank name is rejected with validation_error" */
      it("rejects with validation_error and stores nothing", async () => {
        const { service, suiteRepo } = createService();

        await expect(
          service.createTestSuite({ projectId: "proj_1", name: "   " }),
        ).rejects.toMatchObject({ code: "validation_error" });

        expect(suiteRepo.create).not.toHaveBeenCalled();
      });
    });

    describe("when the slug is free", () => {
      it("creates an empty test suite", async () => {
        const { service, suiteRepo } = createService();
        suiteRepo.create.mockImplementation(
          async (input: Record<string, unknown>) => makeSuite(input),
        );

        await service.createTestSuite({ projectId: "proj_1", name: "Refunds" });

        expect(suiteRepo.create).toHaveBeenCalledWith({
          projectId: "proj_1",
          name: "Refunds",
          slug: "refunds",
          kind: "test_suite",
          scenarioIds: [],
          targets: [],
          repeatCount: 1,
          labels: [],
          fields: [],
          evaluators: [],
        });
      });
    });

    describe("when another suite already holds the slug", () => {
      /** @scenario "A test suite created with a name another suite already uses keeps both names readable" */
      it("appends a numeric suffix instead of refusing", async () => {
        const { service, suiteRepo } = createService({
          suiteRepository: {
            findSlugsByPrefix: vi
              .fn()
              .mockResolvedValue(["refunds", "refunds-2"]),
          },
        });
        suiteRepo.create.mockImplementation(
          async (input: Record<string, unknown>) => makeSuite(input),
        );

        const testSuite = await service.createTestSuite({
          projectId: "proj_1",
          name: "Refunds",
        });

        expect(testSuite.name).toBe("Refunds");
        expect(testSuite.slug).toBe("refunds-3");
      });

      it("retries once when the insert loses the slug race", async () => {
        const raceLoss = Object.assign(new Error("unique"), {
          code: "P2002",
        });
        const { service, suiteRepo } = createService();
        suiteRepo.findSlugsByPrefix
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(["refunds"]);
        suiteRepo.create
          .mockRejectedValueOnce(raceLoss)
          .mockImplementation(async (input: Record<string, unknown>) =>
            makeSuite(input),
          );

        const testSuite = await service.createTestSuite({
          projectId: "proj_1",
          name: "Refunds",
        });

        expect(testSuite.slug).toBe("refunds-2");
        expect(suiteRepo.create).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("when running a test suite", () => {
    /** The plan row runTestSuite resolves, so the run has something to run. */
    function testSuiteRunService() {
      const created = createService({
        suiteRepository: {
          findNamesByIds: vi
            .fn()
            .mockResolvedValue([{ id: "test_suite_1", name: "Refunds" }]),
        },
        scenarioRepository: {
          findNamesByIds: vi.fn(async ({ ids }: { ids: string[] }) =>
            ids.map((id) => ({ id, name: id })),
          ),
        },
        agentRepository: {
          findNamesByIds: vi
            .fn()
            .mockResolvedValue([{ id: "agent_1", name: "prod-agent" }]),
        },
        prisma: {
          simulationSuite: {
            findMany: vi.fn(async () => [
              { id: "test_suite_1" },
              { id: "test_suite_2" },
            ]),
          },
          scenario: {
            findMany: vi.fn(async () => [{ id: "scen_1" }, { id: "scen_2" }]),
          },
        },
      });
      created.suiteRepo.findById.mockResolvedValue(
        makeSuite({ id: "test_suite_1", kind: "test_suite", name: "Refunds" }),
      );
      created.suiteRepo.create.mockImplementation(
        async (input: Record<string, unknown>) => makeSuite(input),
      );
      return created;
    }

    describe("when the run carries a repeat count", () => {
      /** @scenario "A test suite run honours the repeat count sent with the run" */
      it("schedules scenarios x targets x repeat count runs", async () => {
        const { service, suiteRunService, suiteRepo } = testSuiteRunService();

        const result = await service.runTestSuite({
          ...RUN_DEFAULTS,
          testSuiteId: "test_suite_1",
          targets: [{ type: "http", referenceId: "agent_1" }],
          repeatCount: 3,
        });

        expect(result.jobCount).toBe(6);
        expect(suiteRunService.startRun).toHaveBeenCalledWith(
          expect.objectContaining({ repeatCount: 3 }),
        );
        // The settings land on the run plan the run resolved, never on the
        // test suite row.
        // The second argument carries the transaction client, so the plan is
        // written under the name lock that the matching read was taken with.
        expect(suiteRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "run_plan", repeatCount: 3 }),
          expect.objectContaining({ tx: expect.anything() }),
        );
        expect(suiteRepo.update).not.toHaveBeenCalled();
      });
    });

    describe("when the run names no target", () => {
      it("refuses with suite_targets_required before reading the suite", async () => {
        const { service, suiteRepo, suiteRunService } = testSuiteRunService();

        await expect(
          service.runTestSuite({
            ...RUN_DEFAULTS,
            testSuiteId: "test_suite_1",
            targets: [],
          }),
        ).rejects.toMatchObject({ code: "suite_targets_required" });

        expect(suiteRepo.findById).not.toHaveBeenCalled();
        expect(suiteRunService.startRun).not.toHaveBeenCalled();
      });
    });

    describe("when the id names a run plan", () => {
      it("refuses with suite_not_found", async () => {
        const { service, suiteRepo } = testSuiteRunService();
        suiteRepo.findById.mockResolvedValue(makeSuite({ kind: "run_plan" }));

        await expect(
          service.runTestSuite({
            ...RUN_DEFAULTS,
            testSuiteId: "suite_abc123",
            targets: [{ type: "http", referenceId: "agent_1" }],
          }),
        ).rejects.toMatchObject({ code: "suite_not_found" });
      });
    });

    describe("when the run carries no name", () => {
      /** @scenario "A run started with no name is named after its scope and targets" */
      it("names the plan after the suite and its targets", async () => {
        const { service, suiteRepo, agentRepo } = testSuiteRunService();
        agentRepo.findNamesByIds.mockResolvedValue([
          { id: "agent_1", name: "dev-agent" },
          { id: "agent_2", name: "prod-agent" },
        ]);

        const result = await service.runTestSuite({
          ...RUN_DEFAULTS,
          testSuiteId: "test_suite_1",
          targets: [
            { type: "http", referenceId: "agent_2" },
            { type: "http", referenceId: "agent_1" },
          ],
        });

        expect(result.planName).toBe("Refunds dev-agent vs prod-agent");
        expect(suiteRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ name: "Refunds dev-agent vs prod-agent" }),
          expect.objectContaining({ tx: expect.anything() }),
        );
      });
    });
  });

  describe("when running one scenario", () => {
    describe("when the scenario does not exist", () => {
      it("refuses before anything is scheduled", async () => {
        const { service, suiteRunService } = createService({
          scenarioRepository: { findNamesByIds: vi.fn(async () => []) },
        });

        await expect(
          service.runScenario({
            ...RUN_DEFAULTS,
            scenarioId: "scen_missing",
            targets: [{ type: "http", referenceId: "agent_1" }],
          }),
        ).rejects.toMatchObject({ name: "ScenarioNotFoundError" });

        expect(suiteRunService.startRun).not.toHaveBeenCalled();
      });
    });

    describe("when the run carries no name", () => {
      it("names the plan after the scenario and its target", async () => {
        const { service, suiteRepo } = createService({
          scenarioRepository: {
            findNamesByIds: vi
              .fn()
              .mockResolvedValue([
                { id: "scen_1", name: "Angry refund request" },
              ]),
          },
          agentRepository: {
            findNamesByIds: vi
              .fn()
              .mockResolvedValue([{ id: "agent_1", name: "prod-agent" }]),
          },
        });
        suiteRepo.create.mockImplementation(
          async (input: Record<string, unknown>) => makeSuite(input),
        );

        const result = await service.runScenario({
          ...RUN_DEFAULTS,
          scenarioId: "scen_1",
          targets: [{ type: "http", referenceId: "agent_1" }],
        });

        expect(result.planName).toBe("Angry refund request prod-agent");
      });
    });
  });

  describe("when a run plan is run by its id", () => {
    /** @scenario "A run plan run through the test suite path refuses stored execution settings" */
    it("refuses a request that carries execution settings", async () => {
      const { service, suiteRunService } = createService();

      await expect(
        service.run({
          suite: makeSuite(),
          ...RUN_DEFAULTS,
          targets: [{ type: "http", referenceId: "agent_9" }],
          repeatCount: 2,
        }),
      ).rejects.toMatchObject({
        code: "validation_error",
        meta: {
          fieldErrors: {
            targets: [expect.stringContaining("stored configuration")],
            repeatCount: [expect.stringContaining("stored configuration")],
          },
        },
      });

      expect(suiteRunService.startRun).not.toHaveBeenCalled();
    });

    it("runs its stored configuration when the request carries none", async () => {
      const { service, suiteRunService } = createService();

      const result = await service.run({ suite: makeSuite(), ...RUN_DEFAULTS });

      expect(result.jobCount).toBe(6);
      expect(suiteRunService.startRun).toHaveBeenCalled();
    });
  });

  describe("given a test suite", () => {
    describe("when the suite editor updates it", () => {
      /** @scenario "The suite editor refuses execution settings on a test suite" */
      it("saves the name and labels and refuses every execution field", async () => {
        const { service, suiteRepo } = createService();
        const stored = makeSuite({
          id: "test_suite_1",
          kind: "test_suite",
          slug: "refunds",
          name: "Refunds",
        });
        suiteRepo.findById.mockResolvedValue(stored);
        suiteRepo.update.mockImplementation(
          async ({ data }: { data: Record<string, unknown> }) =>
            makeSuite({ ...stored, ...data }),
        );

        await service.update({
          id: stored.id,
          projectId: stored.projectId,
          data: { name: "Refunds v2", labels: ["priority"] },
        });

        expect(suiteRepo.update).toHaveBeenCalledWith(
          expect.objectContaining({
            id: stored.id,
            data: expect.not.objectContaining({ slug: expect.anything() }),
          }),
        );
        const firstCall = suiteRepo.update.mock.calls[0];
        if (!firstCall) throw new Error("update was not called");
        const data = firstCall[0].data as Record<string, unknown>;
        expect(data.name).toBe("Refunds v2");
        expect(data.labels).toEqual(["priority"]);

        suiteRepo.update.mockClear();
        await expect(
          service.update({
            id: stored.id,
            projectId: stored.projectId,
            data: {
              targets: [
                { type: "http", referenceId: "agent_2" },
              ] as SuiteTarget[],
              repeatCount: 3,
              simulatorModel: "openai/gpt-5-mini",
              judgeModel: "openai/gpt-5-mini",
            },
          }),
        ).rejects.toMatchObject({
          code: "validation_error",
          meta: {
            fieldErrors: {
              targets: expect.any(Array),
              repeatCount: expect.any(Array),
              simulatorModel: expect.any(Array),
              judgeModel: expect.any(Array),
            },
          },
        });
        expect(suiteRepo.update).not.toHaveBeenCalled();
      });

      /** @scenario "The suite editor refuses to broaden a test suite into a code-owned suite" */
      it("refuses a scope or scenarioIds write on a test suite", async () => {
        const { service, suiteRepo } = createService();
        suiteRepo.findById.mockResolvedValue(
          makeSuite({ id: "test_suite_1", kind: "test_suite" }),
        );

        await expect(
          service.update({
            id: "test_suite_1",
            projectId: "proj_1",
            data: { scope: { mode: "all" } },
          }),
        ).rejects.toMatchObject({ code: "suite_scope_not_allowed" });

        await expect(
          service.update({
            id: "test_suite_1",
            projectId: "proj_1",
            data: { scenarioIds: ["scen_x"] },
          }),
        ).rejects.toMatchObject({ code: "validation_error" });
      });
    });
  });
});
