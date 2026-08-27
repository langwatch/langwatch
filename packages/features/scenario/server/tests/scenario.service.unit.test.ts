import {
  ScenarioFolderNotFoundError,
  ScenarioNotFoundError,
  type Scenario,
  type ScenarioCreateInput,
  type ScenarioFolder,
  type ScenarioFolderCreateInput,
  type ScenarioFolderIdInput,
  type ScenarioFolderRenameInput,
  type ScenarioFolderRunDefinition,
  type ScenarioFolderUpdateInput,
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
import { ScenarioRepository } from "../src/repositories/scenario.repository";
import { ScenarioService } from "../src/services/scenario.service";
import { ScenarioClockPort } from "../src/ports/scenario-clock.port";
import { ScenarioFolderIdPort, ScenarioIdPort } from "../src/ports/scenario-id.port";
import { ScenarioSecretCipherPort } from "../src/ports/scenario-secret-cipher.port";

const simulations = Object.create(SimulationService.prototype) as SimulationService;

class TestScenarioId extends ScenarioIdPort {
  constructor(private readonly value: string) {
    super();
  }
  next(): string {
    return this.value;
  }
}

class TestScenarioFolderId extends ScenarioFolderIdPort {
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
    folderIds: new TestScenarioFolderId(`folder_${id}`),
    clock,
    secretCipher: new TestScenarioSecretCipher(),
  };
}

class MemoryScenarioRepository extends ScenarioRepository {
  readonly rows = new Map<string, Scenario>();
  readonly folders = new Map<string, ScenarioFolder>();

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
      folderId: scenarioInput.folderId ?? null,
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

  async createFolder(input: ScenarioFolderCreateInput & { id: string }): Promise<ScenarioFolder> {
    const folder: ScenarioFolder = {
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
      kind: "folder",
      scope: null,
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.folders.set(folder.id, folder);
    return folder;
  }

  findFolders(input: { projectId: string }): Promise<ScenarioFolder[]> {
    return Promise.resolve(
      [...this.folders.values()].filter(
        (folder) => folder.projectId === input.projectId && folder.archivedAt === null,
      ),
    );
  }

  tryFindFolder(input: ScenarioFolderIdInput): Promise<ScenarioFolder | null> {
    const folder = this.folders.get(input.folderId);
    return Promise.resolve(
      folder?.projectId === input.projectId && folder.archivedAt === null ? folder : null,
    );
  }

  async renameFolder(input: ScenarioFolderRenameInput): Promise<ScenarioFolder> {
    return this.updateFolder(input);
  }

  async updateFolder(input: ScenarioFolderUpdateInput): Promise<ScenarioFolder> {
    const folder = await this.tryFindFolder(input);
    if (!folder) throw new ScenarioFolderNotFoundError();

    const { folderId: _, projectId: __, ...changes } = input;
    const updated = { ...folder, ...changes, updatedAt: new Date(1) };
    this.folders.set(updated.id, updated);
    return updated;
  }

  async getFolderRunDefinition(input: ScenarioFolderIdInput): Promise<ScenarioFolderRunDefinition> {
    const folder = await this.tryFindFolder(input);
    if (!folder) throw new ScenarioFolderNotFoundError();

    return { folder, scenarioIds: folder.scenarioIds };
  }

  async archiveFolder(
    input: ScenarioFolderIdInput & { archivedAt: Date },
  ): Promise<ScenarioFolder> {
    const folder = this.folders.get(input.folderId);
    if (!folder || folder.projectId !== input.projectId) throw new ScenarioFolderNotFoundError();

    const archived = { ...folder, archivedAt: folder.archivedAt ?? input.archivedAt };
    this.folders.set(archived.id, archived);
    return archived;
  }
}

describe("ScenarioService", () => {
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
