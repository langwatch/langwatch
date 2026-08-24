import {
  AllScenariosArchivedError,
  AllTargetsArchivedError,
  InvalidScenarioReferencesError,
  InvalidTargetReferencesError,
  type Suite,
  type SuiteRunResult,
  SuiteNameTakenError,
  SuiteNotFoundError,
} from "@langwatch/suite-contract";
import { AgentService } from "@langwatch/agent-contract";
import { PromptService } from "@langwatch/prompt-contract";
import { ScenarioService } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";
import { SuiteExecutionPort } from "../src/ports/suite-execution.port";
import { SuiteRepository } from "../src/repositories/suite.repository";
import {
  SuiteService,
  type SuiteServiceOptions,
} from "../src/services/suite.service";

const suite = (overrides: Partial<Suite> = {}): Suite => ({
  id: "suite_original",
  projectId: "project_1",
  name: "Critical path",
  slug: "critical-path",
  description: null,
  scenarioIds: ["scenario_1"],
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
    scenarios: {} as ScenarioService,
    agents: {} as AgentService,
    prompts: {} as PromptService,
    execution: new UnusedExecutionPort(),
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
  it("creates a slugged suite through its own repository", async () => {
    const repo = repository({ create: vi.fn().mockImplementation(async (input) => suite(input)) });
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

  it("throws a domain error when a definition is absent", async () => {
    const service = SuiteService.create(
      serviceOptions(repository({ tryFindById: vi.fn().mockResolvedValue(null) })),
    );
    await expect(service.get({ id: "suite_missing", projectId: "project_1" })).rejects.toBeInstanceOf(SuiteNotFoundError);
  });

  it("rejects an occupied slug", async () => {
    const service = SuiteService.create(
      serviceOptions(repository({ tryFindBySlug: vi.fn().mockResolvedValue(suite()) })),
    );
    await expect(service.create({ projectId: "project_1", name: "Critical path", scenarioIds: ["scenario_1"], targets: [{ type: "prompt", referenceId: "prompt_1" }] })).rejects.toBeInstanceOf(SuiteNameTakenError);
  });

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
      repository: repository({ tryFindById: vi.fn().mockResolvedValue(suite({
        scenarioIds: ["scenario_active", "scenario_archived"],
        targets: [
          { type: "prompt", referenceId: "prompt_active" },
          { type: "http", referenceId: "agent_archived" },
        ],
      })) }),
      scenarios: mockScenarioService({
        getReferenceStates: vi.fn().mockResolvedValue([
          { id: "scenario_active", archivedAt: null },
          { id: "scenario_archived", archivedAt: new Date() },
        ]),
        getRunConfigs: vi.fn().mockResolvedValue([{
          id: "scenario_active",
          name: "Active scenario",
          situation: "A situation",
          criteria: [],
          parameters: {},
        }]),
        getNamesByIds: vi.fn(),
      }),
      agents: mockAgentService({
        getReferenceStates: vi.fn().mockResolvedValue([
          { id: "agent_archived", archivedAt: new Date() },
        ]),
        getNamesByIds: vi.fn(),
      }),
      prompts: mockPromptService({
        getExistingIds: vi.fn().mockResolvedValue(["prompt_active"]),
        getNamesByIds: vi.fn(),
      }),
      execution: new ExecutionPort(),
    });

    await service.run({
      id: "suite_original",
      projectId: "project_1",
      organizationId: "org_1",
      idempotencyKey: "request_1",
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      activeScenarioIds: ["scenario_active"],
      activeTargets: [{ type: "prompt", referenceId: "prompt_active" }],
      skippedArchived: {
        scenarios: ["scenario_archived"],
        targets: ["agent_archived"],
      },
    }));
  });

  it("refuses a run before execution when every scenario is archived", async () => {
    const execute = vi.fn();
    class ExecutionPort extends SuiteExecutionPort {
      execute = execute;
    }
    const service = SuiteService.create({
      repository: repository({ tryFindById: vi.fn().mockResolvedValue(suite()) }),
      scenarios: mockScenarioService({
        getReferenceStates: vi.fn().mockResolvedValue([
          { id: "scenario_1", archivedAt: new Date() },
        ]),
        getRunConfigs: vi.fn(),
        getNamesByIds: vi.fn(),
      }),
      agents: mockAgentService({ getReferenceStates: vi.fn(), getNamesByIds: vi.fn() }),
      prompts: mockPromptService({ getExistingIds: vi.fn(), getNamesByIds: vi.fn() }),
      execution: new ExecutionPort(),
    });

    await expect(service.run({
      id: "suite_original",
      projectId: "project_1",
      organizationId: "org_1",
      idempotencyKey: "request_1",
    })).rejects.toBeInstanceOf(AllScenariosArchivedError);
    expect(execute).not.toHaveBeenCalled();
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
        tryFindById: vi.fn().mockResolvedValue(suite({
          scenarioIds: ["scenario_active", "scenario_archived"],
          targets: [
            { type: "http", referenceId: "agent_active" },
            { type: "code", referenceId: "agent_archived" },
            { type: "prompt", referenceId: "prompt_active" },
          ],
          repeatCount: 2,
        })),
      }),
      scenarios: mockScenarioService({
        getReferenceStates: vi.fn().mockResolvedValue([
          { id: "scenario_active", archivedAt: null },
          { id: "scenario_archived", archivedAt: new Date() },
        ]),
        getRunConfigs: vi.fn().mockResolvedValue([{
          id: "scenario_active",
          name: "Active scenario",
          situation: "A situation",
          criteria: [],
          parameters: null,
        }]),
        getNamesByIds: vi.fn(),
      }),
      agents,
      prompts,
      execution,
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
    expect(execution.execute).toHaveBeenCalledWith(expect.objectContaining({
      activeScenarioIds: ["scenario_active"],
      activeTargets: [
        { type: "http", referenceId: "agent_active" },
        { type: "prompt", referenceId: "prompt_active" },
      ],
      idempotencyKey: "request_1",
      batchRunId: "batch_client_1",
    }));
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
    });

    await expect(service.run({
      id: "suite_original",
      projectId: "project_1",
      organizationId: "org_1",
      idempotencyKey: "request_1",
    })).rejects.toBeInstanceOf(InvalidScenarioReferencesError);
    expect(execution.execute).not.toHaveBeenCalled();

    const targetExecution = new CapturingExecutionPort();
    const targetService = SuiteService.create({
      repository: repository({ tryFindById: vi.fn().mockResolvedValue(suite({
        targets: [{ type: "http", referenceId: "missing_agent" }],
      })) }),
      scenarios: mockScenarioService({
        getReferenceStates: vi.fn().mockResolvedValue([{ id: "scenario_1", archivedAt: null }]),
        getRunConfigs: vi.fn(),
        getNamesByIds: vi.fn(),
      }),
      agents: mockAgentService({ getReferenceStates: vi.fn().mockResolvedValue([]), getNamesByIds: vi.fn() }),
      prompts: mockPromptService({ getExistingIds: vi.fn(), getNamesByIds: vi.fn() }),
      execution: targetExecution,
    });

    await expect(targetService.run({
      id: "suite_original",
      projectId: "project_1",
      organizationId: "org_1",
      idempotencyKey: "request_2",
    })).rejects.toBeInstanceOf(InvalidTargetReferencesError);
    expect(targetExecution.execute).not.toHaveBeenCalled();
  });

  it("rejects when every target is archived", async () => {
    const execution = new CapturingExecutionPort();
    const service = SuiteService.create({
      repository: repository({ tryFindById: vi.fn().mockResolvedValue(suite({
        targets: [{ type: "http", referenceId: "agent_archived" }],
      })) }),
      scenarios: mockScenarioService({
        getReferenceStates: vi.fn().mockResolvedValue([{ id: "scenario_1", archivedAt: null }]),
        getRunConfigs: vi.fn(),
        getNamesByIds: vi.fn(),
      }),
      agents: mockAgentService({
        getReferenceStates: vi.fn().mockResolvedValue([{ id: "agent_archived", archivedAt: new Date() }]),
        getNamesByIds: vi.fn(),
      }),
      prompts: mockPromptService({ getExistingIds: vi.fn(), getNamesByIds: vi.fn() }),
      execution,
    });

    await expect(service.run({
      id: "suite_original",
      projectId: "project_1",
      organizationId: "org_1",
      idempotencyKey: "request_1",
    })).rejects.toBeInstanceOf(AllTargetsArchivedError);
    expect(execution.execute).not.toHaveBeenCalled();
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
    const service = SuiteService.create(serviceOptions(repository(), {
      scenarios,
      agents,
      prompts,
    }));

    await expect(service.resolveArchivedNames({
      projectId: "project_1",
      organizationId: "org_1",
      scenarioIds: ["scenario_1"],
      targets: [
        { type: "http", referenceId: "agent_1" },
        { type: "prompt", referenceId: "prompt_1" },
      ],
    })).resolves.toEqual({
      scenarios: { scenario_1: "Scenario" },
      targets: { agent_1: "Agent", prompt_1: "Prompt" },
    });
  });

  it("duplicates and archives through only the Suite repository", async () => {
    const original = suite({ id: "suite_1", name: "Critical path", labels: ["smoke"] });
    const repo = repository({
      tryFindById: vi.fn().mockResolvedValue(original),
      create: vi.fn().mockImplementation(async (input) => suite(input)),
      archive: vi.fn().mockImplementation(async (input) => suite({
        ...input,
        archivedAt: input.archivedAt,
        slug: input.archivedSlug,
      })),
    });
    const service = SuiteService.create(serviceOptions(repo, {
      generateId: () => "suite_copy",
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    }));

    await service.duplicate({ id: "suite_1", projectId: "project_1" });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      id: "suite_copy",
      name: "Critical path (copy)",
      scenarioIds: original.scenarioIds,
      targets: original.targets,
      labels: ["smoke"],
    }));
    await service.archive({ id: "suite_1", projectId: "project_1" });
    expect(repo.archive).toHaveBeenCalledWith(expect.objectContaining({
      id: "suite_1",
      projectId: "project_1",
      archivedSlug: "critical-path__archived-uite_1",
    }));
  });
});
