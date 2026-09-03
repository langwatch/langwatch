import {
  ScenarioTestSuiteNotFoundError,
  ScenarioNotFoundError,
  type Scenario,
  type ScenarioCreateInput,
  type ScenarioTestSuite,
  type ScenarioTestSuiteCreateInput,
  type ScenarioTestSuiteIdInput,
  type ScenarioTestSuiteRenameInput,
  type ScenarioTestSuiteRunDefinition,
  type ScenarioTestSuiteUpdateInput,
  type ScenarioReferenceState,
  type ScenarioRunConfig,
  type ScenarioUpdateInput,
  type ScenarioActor,
  type ScenarioVersionDetail,
  type ScenarioVersionInput,
  type ScenarioVersionListInput,
  type ScenarioVersionRestoreInput,
  type ScenarioVersionSummary,
} from "@langwatch/scenario-contract";
import { SimulationService } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";
import { ScenarioRepository } from "../scenario.repository";
import { ScenarioService } from "../../services/scenario.service";
import { ScenarioClockPort } from "../../ports/scenario-clock.port";
import { ScenarioTestSuiteIdPort, ScenarioIdPort } from "../../ports/scenario-id.port";
import { ScenarioSecretCipherPort } from "../../ports/scenario-secret-cipher.port";

const simulations = Object.create(SimulationService.prototype) as SimulationService;

class TestScenarioId extends ScenarioIdPort {
  constructor(private readonly value: string) {
    super();
  }
  next(): string {
    return this.value;
  }
}

class TestScenarioTestSuiteId extends ScenarioTestSuiteIdPort {
  constructor(private readonly value: string) {
    super();
  }

  next(): string {
    return this.value;
  }
}

class TestScenarioClock extends ScenarioClockPort {
  constructor(private readonly value: Date = new Date(0)) {
    super();
  }
  now(): Date {
    return this.value;
  }
}

class TestScenarioSecretCipher extends ScenarioSecretCipherPort {
  encrypt(value: string): string {
    return `encrypted:${value}`;
  }

  decrypt(value: string): string {
    return value.replace(/^encrypted:/, "");
  }
}

function serviceOptions(
  repository: ScenarioRepository,
  id: string,
  clock = new TestScenarioClock(),
) {
  return {
    repository,
    simulations,
    ids: new TestScenarioId(id),
    testSuiteIds: new TestScenarioTestSuiteId(`test_suite_${id}`),
    clock,
    secretCipher: new TestScenarioSecretCipher(),
  };
}

class MemoryScenarioRepository extends ScenarioRepository {
  readonly rows = new Map<string, Scenario>();
  readonly testSuites = new Map<string, ScenarioTestSuite>();

  async create(
    input: ScenarioCreateInput & { id: string; actor: ScenarioActor },
  ): Promise<Scenario> {
    const { actor: _, ...scenarioInput } = input;
    const row: Scenario = {
      ...scenarioInput,
      parameters: scenarioInput.parameters ?? null,
      simulatorModel: scenarioInput.simulatorModel ?? null,
      judgeModel: scenarioInput.judgeModel ?? null,
      maxTurns: scenarioInput.maxTurns ?? null,
      minTurns: scenarioInput.minTurns ?? null,
      testSuiteId: scenarioInput.testSuiteId ?? null,
      version: 1,
      lastUpdatedById: scenarioInput.lastUpdatedById ?? null,
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.rows.set(row.id, row);
    return row;
  }

  tryFindById(input: { id: string; projectId: string }): Promise<Scenario | null> {
    const row = this.rows.get(input.id);
    return Promise.resolve(
      row?.projectId === input.projectId && row.archivedAt === null ? row : null,
    );
  }

  async findById(input: { id: string; projectId: string }): Promise<Scenario> {
    const row = this.rows.get(input.id);
    if (row?.projectId !== input.projectId || row.archivedAt !== null) {
      throw new ScenarioNotFoundError(input.id);
    }

    return row;
  }

  async findByIdIncludingArchived(input: { id: string; projectId: string }): Promise<Scenario> {
    const row = this.rows.get(input.id);
    if (row?.projectId !== input.projectId) {
      throw new ScenarioNotFoundError(input.id);
    }

    return row;
  }

  tryFindByIdIncludingArchived(input: { id: string; projectId: string }): Promise<Scenario | null> {
    const row = this.rows.get(input.id);
    return Promise.resolve(row?.projectId === input.projectId ? row : null);
  }

  findAll(input: { projectId: string }): Promise<Scenario[]> {
    return Promise.resolve(
      [...this.rows.values()].filter(
        (row) => row.projectId === input.projectId && row.archivedAt === null,
      ),
    );
  }

  async count(input: { projectId: string }): Promise<number> {
    return (await this.findAll(input)).length;
  }

  async update(input: ScenarioUpdateInput & { actor: ScenarioActor }): Promise<Scenario> {
    const existing = await this.tryFindByIdIncludingArchived(input);
    if (!existing) throw new ScenarioNotFoundError(input.id);
    const {
      actor: _,
      changeDescription: __,
      expectedVersion: ___,
      id: ____,
      projectId: _____,
      ...data
    } = input;
    const row = { ...existing, ...data, updatedAt: new Date(1) };
    this.rows.set(row.id, row);
    return row;
  }

  findVersions(
    _input: ScenarioVersionListInput & { take: number },
  ): Promise<ScenarioVersionSummary[]> {
    throw new Error("Version history is not exercised by this repository double");
  }

  findVersion(_input: ScenarioVersionInput): Promise<ScenarioVersionDetail> {
    throw new Error("Version history is not exercised by this repository double");
  }

  restoreVersion(_input: ScenarioVersionRestoreInput): Promise<Scenario> {
    throw new Error("Version history is not exercised by this repository double");
  }

  async tryArchive(input: {
    id: string;
    projectId: string;
    archivedAt: Date;
  }): Promise<Scenario | null> {
    const existing = await this.tryFindByIdIncludingArchived(input);
    if (!existing) return null;
    const row = { ...existing, archivedAt: existing.archivedAt ?? input.archivedAt };
    this.rows.set(row.id, row);
    return row;
  }

  async archiveMany(input: {
    ids: string[];
    projectId: string;
    archivedAt: Date;
  }): Promise<{ archived: string[]; missing: string[] }> {
    const archived: string[] = [];
    const missing: string[] = [];
    for (const id of input.ids) {
      const row = await this.tryArchive({
        id,
        projectId: input.projectId,
        archivedAt: input.archivedAt,
      });
      if (row) archived.push(id);
      else missing.push(id);
    }
    return { archived, missing };
  }

  async findRunConfigs(input: { ids: string[]; projectId: string }): Promise<ScenarioRunConfig[]> {
    return [...this.rows.values()]
      .filter((row) => input.ids.includes(row.id) && row.projectId === input.projectId)
      .map(({ id, name, version, situation, criteria, parameters }) => ({
        id,
        name,
        version,
        situation,
        criteria,
        parameters,
      }));
  }

  async findReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioReferenceState[]> {
    return [...this.rows.values()]
      .filter((row) => input.ids.includes(row.id) && row.projectId === input.projectId)
      .map(({ id, archivedAt }) => ({ id, archivedAt }));
  }

  async findNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    return [...this.rows.values()]
      .filter((row) => input.ids.includes(row.id) && row.projectId === input.projectId)
      .map(({ id, name }) => ({ id, name }));
  }

  async createTestSuite(
    input: ScenarioTestSuiteCreateInput & { id: string },
  ): Promise<ScenarioTestSuite> {
    const testSuite: ScenarioTestSuite = {
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      slug: input.name.toLowerCase(),
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
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.testSuites.set(testSuite.id, testSuite);
    return testSuite;
  }

  findTestSuites(input: { projectId: string }): Promise<ScenarioTestSuite[]> {
    return Promise.resolve(
      [...this.testSuites.values()].filter(
        (testSuite) => testSuite.projectId === input.projectId && testSuite.archivedAt === null,
      ),
    );
  }

  tryFindTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null> {
    const testSuite = this.testSuites.get(input.testSuiteId);
    return Promise.resolve(
      testSuite?.projectId === input.projectId && testSuite.archivedAt === null ? testSuite : null,
    );
  }

  async renameTestSuite(input: ScenarioTestSuiteRenameInput): Promise<ScenarioTestSuite> {
    return this.updateTestSuite(input);
  }

  async updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite> {
    const testSuite = await this.tryFindTestSuite(input);
    if (!testSuite) throw new ScenarioTestSuiteNotFoundError();

    const { testSuiteId: _, projectId: __, ...changes } = input;
    const updated = { ...testSuite, ...changes, updatedAt: new Date(1) };
    this.testSuites.set(updated.id, updated);
    return updated;
  }

  async getTestSuiteRunDefinition(
    input: ScenarioTestSuiteIdInput,
  ): Promise<ScenarioTestSuiteRunDefinition> {
    const testSuite = await this.tryFindTestSuite(input);
    if (!testSuite) throw new ScenarioTestSuiteNotFoundError();

    return { testSuite, scenarioIds: testSuite.scenarioIds };
  }

  async archiveTestSuite(
    input: ScenarioTestSuiteIdInput & { archivedAt: Date },
  ): Promise<ScenarioTestSuite> {
    const testSuite = this.testSuites.get(input.testSuiteId);
    if (!testSuite || testSuite.projectId !== input.projectId)
      throw new ScenarioTestSuiteNotFoundError();

    const archived = { ...testSuite, archivedAt: testSuite.archivedAt ?? input.archivedAt };
    this.testSuites.set(archived.id, archived);
    return archived;
  }
}

describe("ScenarioService", () => {
  /** @scenario "A required scenario read is tenant scoped" */
  /** @scenario "Optional scenario discovery is explicit" */
  it("keeps reads project-scoped and only makes optional reads nullable", async () => {
    const repository = new MemoryScenarioRepository();
    const service = ScenarioService.create(serviceOptions(repository, "scenario_1"));
    await service.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
    });

    expect(await service.tryGetById({ id: "scenario_1", projectId: "project-b" })).toBeNull();
    await expect(
      service.getById({ id: "scenario_1", projectId: "project-b" }),
    ).rejects.toMatchObject({
      name: "ScenarioNotFoundError",
      code: "scenario_not_found",
      httpStatus: 404,
      meta: { scenarioId: "scenario_1" },
    });
    expect(await service.list({ projectId: "project-a" })).toHaveLength(1);
    await expect(service.count({ projectId: "project-a" })).resolves.toBe(1);
    await expect(service.count({ projectId: "project-b" })).resolves.toBe(0);
  });

  /** @scenario "Scenario archive delivery is retry safe" */
  it("preserves the first archive timestamp across retry delivery", async () => {
    const repository = new MemoryScenarioRepository();
    const first = new Date("2026-01-01T00:00:00.000Z");
    const later = new Date("2026-01-02T00:00:00.000Z");
    const service = ScenarioService.create(
      serviceOptions(repository, "scenario_1", new TestScenarioClock(first)),
    );
    await service.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
    });

    const archived = await service.archive({ id: "scenario_1", projectId: "project-a" });
    const retried = await ScenarioService.create(
      serviceOptions(repository, "unused", new TestScenarioClock(later)),
    ).archive({ id: "scenario_1", projectId: "project-a" });

    expect(archived.archivedAt).toEqual(first);
    expect(retried.archivedAt).toEqual(first);
  });

  it("keeps run configuration parameter JSON project-scoped", async () => {
    const repository = new MemoryScenarioRepository();
    const service = ScenarioService.create(serviceOptions(repository, "scenario_1"));
    await service.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A {{ params.region }} customer asks for a refund",
      criteria: ["Answers the question"],
      labels: [],
      parameters: [
        {
          name: "region",
          description: "The customer's billing region",
          defaultValue: "eu-central",
        },
      ],
    });

    await expect(
      service.getRunConfigs({
        ids: ["scenario_1"],
        projectId: "project-a",
      }),
    ).resolves.toEqual([
      {
        id: "scenario_1",
        name: "Refund flow",
        version: 1,
        situation: "A {{ params.region }} customer asks for a refund",
        criteria: ["Answers the question"],
        parameters: [
          {
            name: "region",
            description: "The customer's billing region",
            defaultValue: "eu-central",
          },
        ],
      },
    ]);
    await expect(
      service.resolveRunParameters({
        projectId: "project-a",
        scenarioId: "scenario_1",
      }),
    ).resolves.toEqual({
      parameters: { region: "eu-central" },
      secretParameters: {},
      scenarioVersion: 1,
    });
    await expect(
      service.getRunConfigs({
        ids: ["scenario_1"],
        projectId: "project-b",
      }),
    ).resolves.toEqual([]);
    await expect(
      service.resolveRunParameters({
        projectId: "project-b",
        scenarioId: "scenario_1",
      }),
    ).rejects.toBeInstanceOf(ScenarioNotFoundError);
  });

  it("persists model selections through the canonical update boundary", async () => {
    const repository = new MemoryScenarioRepository();
    const service = ScenarioService.create(serviceOptions(repository, "scenario_1"));
    await service.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
    });

    await expect(
      service.update({
        id: "scenario_1",
        projectId: "project-a",
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5-nano",
      }),
    ).resolves.toMatchObject({
      simulatorModel: "openai/gpt-5-mini",
      judgeModel: "openai/gpt-5-nano",
    });
    await expect(
      service.getById({ id: "scenario_1", projectId: "project-a" }),
    ).resolves.toMatchObject({
      simulatorModel: "openai/gpt-5-mini",
      judgeModel: "openai/gpt-5-nano",
    });
  });

  it("resolves a suite's scenarios together and encrypts secret values", async () => {
    const service = ScenarioService.create(
      serviceOptions(new MemoryScenarioRepository(), "scenario_1"),
    );

    await expect(
      service.resolveRunParametersForScenarios({
        scenarios: [
          {
            id: "scenario_1",
            name: "Refund flow",
            version: 1,
            situation: "A {{ params.region }} customer asks for help",
            criteria: [],
            parameters: [
              { name: "region", defaultValue: "eu" },
              { name: "api_token", secret: true },
            ],
          },
        ],
        values: { api_token: "token-live" },
      }),
    ).resolves.toEqual([
      {
        scenarioId: "scenario_1",
        parameters: { region: "eu" },
        secretParameters: { api_token: "encrypted:token-live" },
        scenarioVersion: 1,
      },
    ]);
  });

  it("rejects an unknown suite parameter before returning schedulable values", async () => {
    const service = ScenarioService.create(
      serviceOptions(new MemoryScenarioRepository(), "scenario_1"),
    );

    await expect(
      service.resolveRunParametersForScenarios({
        scenarios: [
          {
            id: "scenario_1",
            name: "Refund flow",
            version: 1,
            situation: "A customer asks for help",
            criteria: [],
            parameters: [{ name: "region", defaultValue: "eu" }],
          },
        ],
        values: { accountTier: "platinum" },
      }),
    ).rejects.toMatchObject({ code: "scenario_parameter_unknown" });
  });

  it("preserves order, duplicates, retry success, and exact failures in a batch archive", async () => {
    const repository = new MemoryScenarioRepository();
    const firstService = ScenarioService.create(serviceOptions(repository, "scenario_1"));
    const secondService = ScenarioService.create(serviceOptions(repository, "scenario_2"));
    await firstService.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
    });
    await secondService.create({
      projectId: "project-a",
      name: "Checkout flow",
      situation: "A customer checks out",
      criteria: [],
      labels: [],
    });
    await secondService.archive({ id: "scenario_2", projectId: "project-a" });

    await expect(
      firstService.batchArchive({
        projectId: "project-a",
        ids: [
          "scenario_2",
          "scenario_1",
          "scenario_2",
          "scenario_missing",
          "scenario_1",
          "scenario_missing",
        ],
      }),
    ).resolves.toEqual({
      archived: ["scenario_2", "scenario_1", "scenario_2", "scenario_1"],
      failed: [
        {
          id: "scenario_missing",
          error: "Not found",
        },
        {
          id: "scenario_missing",
          error: "Not found",
        },
      ],
    });
    await expect(firstService.list({ projectId: "project-a" })).resolves.toEqual([]);
  });
});
