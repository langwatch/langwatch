import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  SuiteScopeNotAllowedError,
  suiteSchema,
  type Suite,
  type SuiteScope,
  type SuiteRunResult,
  SuiteNameTakenError,
  SuiteNotFoundError,
  SuiteScopeEmptyError,
  SuiteTargetsRequiredError,
} from "@langwatch/suite-contract";
import { AgentService } from "@langwatch/agent-contract";
import { PromptService } from "@langwatch/prompt-contract";
import {
  ScenarioTestSuiteNotFoundError,
  ScenarioService,
  scenarioSchema,
  type Scenario,
} from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";
import { SuiteExecutionPort } from "../../ports/suite-execution.port";
import { SuiteRepository } from "../suite.repository";
import { MemorySuiteRunRepository } from "../memory/memory.suite-run.repository";
import { SuiteService, type SuiteServiceOptions } from "../../services/suite.service";

const suite = (overrides: Partial<Suite> = {}): Suite =>
  suiteSchema.parse({
    id: "suite_original",
    projectId: "project_1",
    name: "Critical path",
    slug: "critical-path",
    kind: "run_plan",
    description: null,
    scenarioIds: ["scenario_1"],
    scope: null,
    targets: [{ type: "prompt", referenceId: "prompt_1" }],
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

const scenario = (overrides: Partial<Scenario> = {}): Scenario =>
  scenarioSchema.parse({
    id: "scenario_1",
    projectId: "project_1",
    name: "Scenario",
    situation: "A situation",
    criteria: [],
    labels: [],
    parameters: null,
    simulatorModel: null,
    judgeModel: null,
    maxTurns: null,
    minTurns: null,
    testSuiteId: null,
    version: 1,
    lastUpdatedById: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

function repository(overrides: Partial<SuiteRepository> = {}): SuiteRepository {
  return {
    create: vi.fn(),
    list: vi.fn(),
    tryFindById: vi.fn(),
    tryFindBySlug: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    archive: vi.fn(),
    ...overrides,
  } as SuiteRepository;
}

class UnusedExecutionPort extends SuiteExecutionPort {
  async execute(): Promise<SuiteRunResult> {
    throw new Error("This test does not execute a suite run");
  }
}

class CapturingExecutionPort extends SuiteExecutionPort {
  readonly execute = vi.fn(async (input) => ({
    batchRunId: "batch_1",
    setId: "suite:set_1",
    jobCount: input.activeScenarioIds.length * input.activeTargets.length * input.repeatCount,
    skippedArchived: input.skippedArchived,
    items: [],
  }));
}

function serviceOptions(
  repo: SuiteRepository,
  overrides: Partial<SuiteServiceOptions> = {},
): SuiteServiceOptions {
  return {
    repository: repo,
    scenarios: mockScenarioService({ tryGetTestSuite: vi.fn().mockResolvedValue(null) }),
    agents: {} as AgentService,
    prompts: {} as PromptService,
    execution: new UnusedExecutionPort(),
    runRepository: MemorySuiteRunRepository.create(),
    ...overrides,
  };
}

function mockScenarioService(methods: object): ScenarioService {
  return Object.assign(Object.create(ScenarioService.prototype), methods);
}

function mockAgentService(methods: object): AgentService {
  return Object.assign(Object.create(AgentService.prototype), methods);
}

function mockPromptService(methods: object): PromptService {
  return Object.assign(Object.create(PromptService.prototype), methods);
}

describe("SuiteService", () => {
  /** @scenario "Create a suite definition" */
  it("creates a slugged suite through its own repository", async () => {
    const repo = repository({
      create: vi.fn().mockImplementation(async (input) => suite(input)),
    });
    const service = SuiteService.create(
      serviceOptions(repo, { generateId: () => "suite_created" }),
    );

    const created = await service.create({
      projectId: "project_1",
      name: "Critical path",
      scenarioIds: ["scenario_1"],
      targets: [{ type: "prompt", referenceId: "prompt_1" }],
    });

    expect(created.id).toBe("suite_created");
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ slug: "critical-path" }));
  });

  /** @scenario "Read a missing suite" */
  it("throws a domain error when a definition is absent", async () => {
    const service = SuiteService.create(
      serviceOptions(repository({ tryFindById: vi.fn().mockResolvedValue(null) })),
    );
    await expect(
      service.get({ id: "suite_missing", projectId: "project_1" }),
    ).rejects.toBeInstanceOf(SuiteNotFoundError);
  });

  /** @scenario "Reject a colliding suite name" */
  it("rejects an occupied slug", async () => {
    const service = SuiteService.create(
      serviceOptions(repository({ tryFindBySlug: vi.fn().mockResolvedValue(suite()) })),
    );
    await expect(
      service.create({
        projectId: "project_1",
        name: "Critical path",
        scenarioIds: ["scenario_1"],
        targets: [{ type: "prompt", referenceId: "prompt_1" }],
      }),
    ).rejects.toBeInstanceOf(SuiteNameTakenError);
  });

  /** @scenario "Resolve a run through owning feature services" */
  it("resolves references before handing a run to the execution port", async () => {
    const execute = vi.fn().mockResolvedValue({
      batchRunId: "batch_1",
      setId: "suite:suite_original",
      jobCount: 1,
      skippedArchived: { scenarios: ["scenario_archived"], targets: ["agent_archived"] },
      items: [],
    });
    class ExecutionPort extends SuiteExecutionPort {
      execute = execute;
    }
    const service = SuiteService.create({
      repository: repository({
        tryFindById: vi.fn().mockResolvedValue(
          suite({
            scenarioIds: ["scenario_active", "scenario_archived"],
            targets: [
              { type: "prompt", referenceId: "prompt_active" },
              { type: "http", referenceId: "agent_archived" },
            ],
          }),
        ),
      }),
      scenarios: mockScenarioService({
        getReferenceStates: vi.fn().mockResolvedValue([
          { id: "scenario_active", archivedAt: null },
          { id: "scenario_archived", archivedAt: new Date() },
        ]),
        getRunConfigs: vi.fn().mockResolvedValue([
          {
            id: "scenario_active",
            name: "Active scenario",
            version: 7,
            situation: "A situation",
            criteria: [],
            parameters: {},
          },
        ]),
        getNamesByIds: vi.fn(),
      }),
      agents: mockAgentService({
        getReferenceStates: vi
          .fn()
          .mockResolvedValue([{ id: "agent_archived", archivedAt: new Date() }]),
        getNamesByIds: vi.fn(),
      }),
      prompts: mockPromptService({
        getExistingIds: vi.fn().mockResolvedValue(["prompt_active"]),
        getNamesByIds: vi.fn(),
      }),
      execution: new ExecutionPort(),
      runRepository: MemorySuiteRunRepository.create(),
    });

    await service.run({
      id: "suite_original",
      projectId: "project_1",
      organizationId: "org_1",
      idempotencyKey: "request_1",
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        activeScenarioIds: ["scenario_active"],
        activeTargets: [{ type: "prompt", referenceId: "prompt_active" }],
        skippedArchived: {
          scenarios: ["scenario_archived"],
          targets: ["agent_archived"],
        },
        scenarioVersions: new Map([["scenario_active", 7]]),
      }),
    );
  });

  it("refuses a run before execution when every scenario is archived", async () => {
    const execute = vi.fn();
    class ExecutionPort extends SuiteExecutionPort {
      execute = execute;
    }
    const service = SuiteService.create({
      repository: repository({ tryFindById: vi.fn().mockResolvedValue(suite()) }),
      scenarios: mockScenarioService({
        getReferenceStates: vi
          .fn()
          .mockResolvedValue([{ id: "scenario_1", archivedAt: new Date() }]),
        getRunConfigs: vi.fn(),
        getNamesByIds: vi.fn(),
      }),
      agents: mockAgentService({ getReferenceStates: vi.fn(), getNamesByIds: vi.fn() }),
      prompts: mockPromptService({ getExistingIds: vi.fn(), getNamesByIds: vi.fn() }),
      execution: new ExecutionPort(),
      runRepository: MemorySuiteRunRepository.create(),
    });

    await expect(
      service.run({
        id: "suite_original",
        projectId: "project_1",
        organizationId: "org_1",
        idempotencyKey: "request_1",
      }),
    ).rejects.toBeInstanceOf(AllScenariosArchivedError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a test suite run without targets before resolving membership", async () => {
    const scenarios = mockScenarioService({
      getTestSuiteRunDefinition: vi.fn(),
    });
    const service = SuiteService.create({
      ...serviceOptions(
        repository({
          tryFindById: vi
            .fn()
            .mockResolvedValue(suite({ kind: "test_suite", scenarioIds: [], targets: [] })),
        }),
        { scenarios },
      ),
    });

    await expect(
      service.run({
        id: "suite_original",
        projectId: "project_1",
        organizationId: "org_1",
        idempotencyKey: "testSuite-no-target",
      }),
    ).rejects.toBeInstanceOf(SuiteTargetsRequiredError);
    expect(scenarios.getTestSuiteRunDefinition).not.toHaveBeenCalled();
  });

  it("refuses a test suite run when every filed scenario is archived", async () => {
    const execution = new CapturingExecutionPort();
    const scenarios = mockScenarioService({
      getTestSuiteRunDefinition: vi.fn().mockResolvedValue({
        testSuite: suite({ kind: "test_suite", scenarioIds: [] }),
        scenarioIds: ["scenario_archived"],
      }),
      getReferenceStates: vi
        .fn()
        .mockResolvedValue([{ id: "scenario_archived", archivedAt: new Date() }]),
      getRunConfigs: vi.fn(),
    });
    const service = SuiteService.create({
      ...serviceOptions(
        repository({
          tryFindById: vi.fn().mockResolvedValue(
            suite({
              kind: "test_suite",
              scenarioIds: [],
              targets: [{ type: "prompt", referenceId: "prompt_1" }],
            }),
          ),
        }),
        { scenarios, execution },
      ),
      prompts: mockPromptService({ getExistingIds: vi.fn() }),
    });

    await expect(
      service.run({
        id: "suite_original",
        projectId: "project_1",
        organizationId: "org_1",
        idempotencyKey: "testSuite-all-archived",
      }),
    ).rejects.toBeInstanceOf(AllScenariosArchivedError);
    expect(execution.execute).not.toHaveBeenCalled();
  });

  const dynamicScopes: Array<{ scope: SuiteScope; membership: string[] }> = [
    { scope: { mode: "all" }, membership: ["scenario_2", "scenario_1"] },
    { scope: { mode: "test_suites", testSuiteIds: ["test_suite_1"] }, membership: ["scenario_1"] },
    { scope: { mode: "labels", labels: ["smoke"] }, membership: ["scenario_1"] },
  ];

  it.each(dynamicScopes)(
    "resolves $scope.mode scope membership at run time",
    async ({ scope, membership }) => {
      const resolveDynamicRunMembership = vi.fn().mockResolvedValue(membership);
      const execution = new CapturingExecutionPort();
      const scenarios = mockScenarioService({
        getReferenceStates: vi
          .fn()
          .mockResolvedValue(membership.map((id) => ({ id, archivedAt: null }))),
        getRunConfigs: vi.fn().mockResolvedValue(
          membership.map((id) => ({
            id,
            name: id,
            version: 1,
            situation: "A situation",
            criteria: [],
            parameters: null,
          })),
        ),
      });
      const service = SuiteService.create({
        ...serviceOptions(
          repository({
            tryFindById: vi.fn().mockResolvedValue(
              suite({
                kind: "run_plan",
                scope,
                scenarioIds: [],
                targets: [{ type: "prompt", referenceId: "prompt_1" }],
              }),
            ),
            resolveDynamicRunMembership,
          }),
          { scenarios, execution },
        ),
        prompts: mockPromptService({ getExistingIds: vi.fn().mockResolvedValue(["prompt_1"]) }),
      });

      await service.run({
        id: "suite_original",
        projectId: "project_1",
        organizationId: "org_1",
        idempotencyKey: "dynamic-scope",
      });

      expect(resolveDynamicRunMembership).toHaveBeenCalledWith({
        id: "suite_original",
        projectId: "project_1",
      });
      expect(execution.execute).toHaveBeenCalledWith(
        expect.objectContaining({ activeScenarioIds: membership }),
      );
    },
  );

  it("refuses a dynamic scope that resolves to no scenarios", async () => {
    const execution = new CapturingExecutionPort();
    const service = SuiteService.create({
      ...serviceOptions(
        repository({
          tryFindById: vi.fn().mockResolvedValue(
            suite({
              scope: { mode: "all" },
              scenarioIds: [],
              targets: [{ type: "prompt", referenceId: "prompt_1" }],
            }),
          ),
          resolveDynamicRunMembership: vi.fn().mockResolvedValue([]),
        }),
        { execution },
      ),
      scenarios: mockScenarioService({ getReferenceStates: vi.fn() }),
      prompts: mockPromptService({ getExistingIds: vi.fn() }),
    });

    await expect(
      service.run({
        id: "suite_original",
        projectId: "project_1",
        organizationId: "org_1",
        idempotencyKey: "empty-scope",
      }),
    ).rejects.toBeInstanceOf(SuiteScopeEmptyError);
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it("batches target checks, filters archived references, and preserves the run idempotency key", async () => {
    const execution = new CapturingExecutionPort();
    const agents = mockAgentService({
      getReferenceStates: vi.fn().mockResolvedValue([
        { id: "agent_active", archivedAt: null },
        { id: "agent_archived", archivedAt: new Date() },
      ]),
      getNamesByIds: vi.fn(),
    });
    const prompts = mockPromptService({
      getExistingIds: vi.fn().mockResolvedValue(["prompt_active"]),
      getNamesByIds: vi.fn(),
    });
    const service = SuiteService.create({
      repository: repository({
        tryFindById: vi.fn().mockResolvedValue(
          suite({
            scenarioIds: ["scenario_active", "scenario_archived"],
            targets: [
              { type: "http", referenceId: "agent_active" },
              { type: "code", referenceId: "agent_archived" },
              { type: "prompt", referenceId: "prompt_active" },
            ],
            repeatCount: 2,
          }),
        ),
      }),
      scenarios: mockScenarioService({
        getReferenceStates: vi.fn().mockResolvedValue([
          { id: "scenario_active", archivedAt: null },
          { id: "scenario_archived", archivedAt: new Date() },
        ]),
        getRunConfigs: vi.fn().mockResolvedValue([
          {
            id: "scenario_active",
            name: "Active scenario",
            situation: "A situation",
            criteria: [],
            parameters: null,
          },
        ]),
        getNamesByIds: vi.fn(),
      }),
      agents,
      prompts,
      execution,
      runRepository: MemorySuiteRunRepository.create(),
    });

    const result = await service.run({
      id: "suite_original",
      projectId: "project_1",
      organizationId: "org_1",
      idempotencyKey: "request_1",
      batchRunId: "batch_client_1",
    });

    expect(result).toMatchObject({
      jobCount: 4,
      skippedArchived: {
        scenarios: ["scenario_archived"],
        targets: ["agent_archived"],
      },
    });
    expect(agents.getReferenceStates).toHaveBeenCalledWith({
      ids: ["agent_active", "agent_archived"],
      projectId: "project_1",
    });
    expect(prompts.getExistingIds).toHaveBeenCalledWith({
      ids: ["prompt_active"],
      projectId: "project_1",
      organizationId: "org_1",
    });
    expect(execution.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        activeScenarioIds: ["scenario_active"],
        activeTargets: [
          { type: "http", referenceId: "agent_active" },
          { type: "prompt", referenceId: "prompt_active" },
        ],
        idempotencyKey: "request_1",
        batchRunId: "batch_client_1",
      }),
    );
  });

  it("rejects missing scenario and target references before execution", async () => {
    const execution = new CapturingExecutionPort();
    const scenarios = mockScenarioService({
      getReferenceStates: vi.fn().mockResolvedValue([]),
      getRunConfigs: vi.fn(),
      getNamesByIds: vi.fn(),
    });
    const service = SuiteService.create({
      repository: repository({ tryFindById: vi.fn().mockResolvedValue(suite()) }),
      scenarios,
      agents: mockAgentService({ getReferenceStates: vi.fn(), getNamesByIds: vi.fn() }),
      prompts: mockPromptService({ getExistingIds: vi.fn(), getNamesByIds: vi.fn() }),
      execution,
      runRepository: MemorySuiteRunRepository.create(),
    });

    await expect(
      service.run({
        id: "suite_original",
        projectId: "project_1",
        organizationId: "org_1",
        idempotencyKey: "request_1",
      }),
    ).rejects.toBeInstanceOf(InvalidScenarioReferencesError);
    expect(execution.execute).not.toHaveBeenCalled();

    const targetExecution = new CapturingExecutionPort();
    const targetService = SuiteService.create({
      repository: repository({
        tryFindById: vi.fn().mockResolvedValue(
          suite({
            targets: [{ type: "http", referenceId: "missing_agent" }],
          }),
        ),
      }),
      scenarios: mockScenarioService({
        getReferenceStates: vi.fn().mockResolvedValue([{ id: "scenario_1", archivedAt: null }]),
        getRunConfigs: vi.fn(),
        getNamesByIds: vi.fn(),
      }),
      agents: mockAgentService({
        getReferenceStates: vi.fn().mockResolvedValue([]),
        getNamesByIds: vi.fn(),
      }),
      prompts: mockPromptService({ getExistingIds: vi.fn(), getNamesByIds: vi.fn() }),
      execution: targetExecution,
      runRepository: MemorySuiteRunRepository.create(),
    });

    await expect(
      targetService.run({
        id: "suite_original",
        projectId: "project_1",
        organizationId: "org_1",
        idempotencyKey: "request_2",
      }),
    ).rejects.toBeInstanceOf(InvalidTargetReferencesError);
    expect(targetExecution.execute).not.toHaveBeenCalled();
  });

  it("rejects when every target is archived", async () => {
    const execution = new CapturingExecutionPort();
    const service = SuiteService.create({
      repository: repository({
        tryFindById: vi.fn().mockResolvedValue(
          suite({
            targets: [{ type: "http", referenceId: "agent_archived" }],
          }),
        ),
      }),
      scenarios: mockScenarioService({
        getReferenceStates: vi.fn().mockResolvedValue([{ id: "scenario_1", archivedAt: null }]),
        getRunConfigs: vi.fn(),
        getNamesByIds: vi.fn(),
      }),
      agents: mockAgentService({
        getReferenceStates: vi
          .fn()
          .mockResolvedValue([{ id: "agent_archived", archivedAt: new Date() }]),
        getNamesByIds: vi.fn(),
      }),
      prompts: mockPromptService({ getExistingIds: vi.fn(), getNamesByIds: vi.fn() }),
      execution,
      runRepository: MemorySuiteRunRepository.create(),
    });

    await expect(
      service.run({
        id: "suite_original",
        projectId: "project_1",
        organizationId: "org_1",
        idempotencyKey: "request_1",
      }),
    ).rejects.toBeInstanceOf(AllTargetsArchivedError);
    expect(execution.execute).not.toHaveBeenCalled();
  });

  it("refreshes and runs the managed all-cases suite", async () => {
    const execution = new CapturingExecutionPort();
    const managed = suite({
      id: "suite_all_cases",
      name: "All test cases",
      labels: ["__managed_all_test_cases__"],
      scenarioIds: ["scenario_1", "scenario_2"],
      targets: [{ type: "http", referenceId: "agent_1" }],
    });
    const saveManagedRunAll = vi.fn().mockResolvedValue(managed);
    const scenarios = mockScenarioService({
      list: vi
        .fn()
        .mockResolvedValue([
          scenario({ id: "scenario_1" }),
          scenario({ id: "scenario_2", name: "Second scenario" }),
        ]),
      getReferenceStates: vi.fn().mockResolvedValue([
        { id: "scenario_1", archivedAt: null },
        { id: "scenario_2", archivedAt: null },
      ]),
      getRunConfigs: vi.fn().mockResolvedValue([
        {
          id: "scenario_1",
          name: "Scenario",
          version: 1,
          situation: "A situation",
          criteria: [],
          parameters: null,
        },
        {
          id: "scenario_2",
          name: "Second scenario",
          version: 2,
          situation: "Another situation",
          criteria: [],
          parameters: null,
        },
      ]),
    });
    const service = SuiteService.create({
      ...serviceOptions(
        repository({
          saveManagedRunAll,
          tryFindById: vi.fn().mockResolvedValue(managed),
        }),
        { scenarios, execution },
      ),
      agents: mockAgentService({
        getReferenceStates: vi.fn().mockResolvedValue([{ id: "agent_1", archivedAt: null }]),
      }),
      prompts: mockPromptService({ getExistingIds: vi.fn() }),
    });

    const result = await service.runAll({
      projectId: "project_1",
      organizationId: "org_1",
      idempotencyKey: "all-cases-1",
      targets: [{ type: "http", referenceId: "agent_1" }],
      note: "nightly",
    });

    expect(result).toMatchObject({ suiteId: "suite_all_cases", jobCount: 2 });
    expect(saveManagedRunAll).toHaveBeenCalledWith({
      id: expect.any(String),
      projectId: "project_1",
      name: "All test cases",
      baseSlug: "all-test-cases",
      label: "managed:run-all",
      scenarioIds: ["scenario_1", "scenario_2"],
      targets: [{ type: "http", referenceId: "agent_1" }],
    });
    expect(execution.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        suiteId: "suite_all_cases",
        activeScenarioIds: ["scenario_1", "scenario_2"],
        idempotencyKey: "all-cases-1",
        note: "nightly",
      }),
    );

    await service.runAll({
      projectId: "project_1",
      organizationId: "org_1",
      idempotencyKey: "all-cases-2",
      note: "reuse targets",
    });
    expect(saveManagedRunAll).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scenarioIds: ["scenario_1", "scenario_2"],
        targets: undefined,
      }),
    );
    expect(execution.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeTargets: [{ type: "http", referenceId: "agent_1" }],
        note: "reuse targets",
      }),
    );
  });

  it("runs a test suite through ScenarioService membership and reports archived cases", async () => {
    const execution = new CapturingExecutionPort();
    const testSuite = suite({
      id: "suite_test_suite",
      kind: "test_suite",
      scenarioIds: [],
      targets: [{ type: "prompt", referenceId: "prompt_1" }],
    });
    const scenarios = mockScenarioService({
      getTestSuiteRunDefinition: vi.fn().mockResolvedValue({
        testSuite,
        scenarioIds: ["scenario_1", "scenario_archived"],
      }),
      getReferenceStates: vi.fn().mockResolvedValue([
        { id: "scenario_1", archivedAt: null },
        { id: "scenario_archived", archivedAt: new Date() },
      ]),
      getRunConfigs: vi.fn().mockResolvedValue([
        {
          id: "scenario_1",
          name: "Scenario",
          version: 1,
          situation: "A situation",
          criteria: [],
          parameters: null,
        },
      ]),
    });
    const service = SuiteService.create({
      ...serviceOptions(repository({ tryFindById: vi.fn().mockResolvedValue(testSuite) }), {
        scenarios,
        execution,
      }),
      agents: mockAgentService({}),
      prompts: mockPromptService({ getExistingIds: vi.fn().mockResolvedValue(["prompt_1"]) }),
    });

    const result = await service.run({
      id: testSuite.id,
      projectId: testSuite.projectId,
      organizationId: "org_1",
      idempotencyKey: "testSuite-run-1",
    });

    expect(result.skippedArchived.scenarios).toEqual(["scenario_archived"]);
    expect(execution.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        suiteId: testSuite.id,
        activeScenarioIds: ["scenario_1"],
      }),
    );
    expect(scenarios.getTestSuiteRunDefinition).toHaveBeenCalledWith({
      testSuiteId: testSuite.id,
      projectId: testSuite.projectId,
    });
  });

  it("loads a test suite through ScenarioService when no custom suite exists", async () => {
    const testSuite = suite({ id: "test_suite_1", kind: "test_suite", scenarioIds: [] });
    const tryGetTestSuite = vi.fn().mockResolvedValue(testSuite);
    const service = SuiteService.create(
      serviceOptions(repository({ tryFindById: vi.fn().mockResolvedValue(null) }), {
        scenarios: mockScenarioService({ tryGetTestSuite }),
      }),
    );

    await expect(
      service.get({ id: testSuite.id, projectId: testSuite.projectId }),
    ).resolves.toEqual(testSuite);
    expect(tryGetTestSuite).toHaveBeenCalledWith({
      testSuiteId: testSuite.id,
      projectId: testSuite.projectId,
    });
  });

  it("keeps test suite membership managed by ScenarioService and maps test suite errors", async () => {
    const testSuite = suite({ id: "test_suite_1", kind: "test_suite", scenarioIds: [] });
    const updateTestSuite = vi.fn().mockResolvedValue(testSuite);
    const scenarios = mockScenarioService({
      tryGetTestSuite: vi.fn().mockResolvedValue(testSuite),
      updateTestSuite,
    });
    const service = SuiteService.create(
      serviceOptions(repository({ tryFindById: vi.fn().mockResolvedValue(testSuite) }), {
        scenarios,
      }),
    );

    await expect(
      service.update({ id: testSuite.id, projectId: testSuite.projectId, name: "Renamed" }),
    ).resolves.toEqual(testSuite);
    expect(updateTestSuite).toHaveBeenCalledWith({
      testSuiteId: testSuite.id,
      projectId: testSuite.projectId,
      name: "Renamed",
    });
    await expect(
      service.update({
        id: testSuite.id,
        projectId: testSuite.projectId,
        scope: { mode: "all" },
      }),
    ).rejects.toBeInstanceOf(SuiteScopeNotAllowedError);
    const missingService = SuiteService.create(
      serviceOptions(repository({ tryFindById: vi.fn().mockResolvedValue(testSuite) }), {
        scenarios: mockScenarioService({
          tryGetTestSuite: vi.fn().mockResolvedValue(testSuite),
          updateTestSuite: vi.fn().mockRejectedValue(new ScenarioTestSuiteNotFoundError()),
        }),
      }),
    );
    await expect(
      missingService.update({ id: testSuite.id, projectId: testSuite.projectId, name: "Renamed" }),
    ).rejects.toBeInstanceOf(SuiteNotFoundError);
  });

  it("maps a missing test suite membership definition to SuiteNotFoundError", async () => {
    const testSuite = suite({ id: "test_suite_1", kind: "test_suite", scenarioIds: [] });
    const service = SuiteService.create({
      ...serviceOptions(repository({ tryFindById: vi.fn().mockResolvedValue(testSuite) })),
      scenarios: mockScenarioService({
        tryGetTestSuite: vi.fn().mockResolvedValue(testSuite),
        getTestSuiteRunDefinition: vi.fn().mockRejectedValue(new ScenarioTestSuiteNotFoundError()),
        getReferenceStates: vi.fn(),
      }),
    });

    await expect(
      service.run({
        id: testSuite.id,
        projectId: testSuite.projectId,
        organizationId: "org_1",
        idempotencyKey: "missing-testSuite-run",
      }),
    ).rejects.toBeInstanceOf(SuiteNotFoundError);
  });

  it("resolves archived names through the canonical feature services", async () => {
    const scenarios = mockScenarioService({
      getReferenceStates: vi.fn(),
      getRunConfigs: vi.fn(),
      getNamesByIds: vi.fn().mockResolvedValue([{ id: "scenario_1", name: "Scenario" }]),
    });
    const agents = mockAgentService({
      getReferenceStates: vi.fn(),
      getNamesByIds: vi.fn().mockResolvedValue([{ id: "agent_1", name: "Agent" }]),
    });
    const prompts = mockPromptService({
      getExistingIds: vi.fn(),
      getNamesByIds: vi.fn().mockResolvedValue([{ id: "prompt_1", name: "Prompt" }]),
    });
    const service = SuiteService.create(
      serviceOptions(repository(), {
        scenarios,
        agents,
        prompts,
      }),
    );

    await expect(
      service.resolveArchivedNames({
        projectId: "project_1",
        organizationId: "org_1",
        scenarioIds: ["scenario_1"],
        targets: [
          { type: "http", referenceId: "agent_1" },
          { type: "prompt", referenceId: "prompt_1" },
        ],
      }),
    ).resolves.toEqual({
      scenarios: { scenario_1: "Scenario" },
      targets: { agent_1: "Agent", prompt_1: "Prompt" },
    });
  });

  it("duplicates and archives through only the Suite repository", async () => {
    const original = suite({ id: "suite_1", name: "Critical path", labels: ["smoke"] });
    const repo = repository({
      tryFindById: vi.fn().mockResolvedValue(original),
      create: vi.fn().mockImplementation(async (input) => suite(input)),
      archive: vi.fn().mockResolvedValue(
        suite({
          id: "suite_1",
          archivedAt: new Date("2026-08-25T00:00:00.000Z"),
          slug: "critical-path--archived-uite_1",
        }),
      ),
    });
    const service = SuiteService.create(
      serviceOptions(repo, {
        generateId: () => "suite_copy",
        now: () => new Date("2026-08-25T00:00:00.000Z"),
      }),
    );

    await service.duplicate({ id: "suite_1", projectId: "project_1" });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "suite_copy",
        name: "Critical path (copy)",
        scenarioIds: original.scenarioIds,
        targets: original.targets,
        labels: ["smoke"],
      }),
    );
    await service.archive({ id: "suite_1", projectId: "project_1" });
    expect(repo.archive).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "suite_1",
        projectId: "project_1",
        archivedSlug: "critical-path--archived-uite_1",
      }),
    );
  });
});
