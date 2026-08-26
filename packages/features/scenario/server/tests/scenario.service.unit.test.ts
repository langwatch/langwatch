import {
  ScenarioNotFoundError,
  type Scenario,
  type ScenarioCreateInput,
  type ScenarioReferenceState,
  type ScenarioRunConfig,
  type ScenarioUpdateInput,
} from "@langwatch/scenario-contract";
import { SimulationService } from "@langwatch/simulation-contract";
import { describe, expect, it } from "vitest";
import { ScenarioRepository } from "../src/repositories/scenario.repository";
import { ScenarioService } from "../src/services/scenario.service";
import { ScenarioClockPort } from "../src/ports/scenario-clock.port";
import { ScenarioIdPort } from "../src/ports/scenario-id.port";
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
    clock,
    secretCipher: new TestScenarioSecretCipher(),
  };
}

class MemoryScenarioRepository extends ScenarioRepository {
  readonly rows = new Map<string, Scenario>();

  async create(input: ScenarioCreateInput & { id: string }): Promise<Scenario> {
    const row: Scenario = {
      ...input,
      parameters: input.parameters ?? null,
      simulatorModel: input.simulatorModel ?? null,
      judgeModel: input.judgeModel ?? null,
      maxTurns: input.maxTurns ?? null,
      minTurns: input.minTurns ?? null,
      lastUpdatedById: input.lastUpdatedById ?? null,
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

  tryFindByIdIncludingArchived(input: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
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

  async update(input: ScenarioUpdateInput): Promise<Scenario> {
    const existing = await this.tryFindByIdIncludingArchived(input);
    if (!existing) throw new ScenarioNotFoundError(input.id);
    const { id: _, projectId: __, ...data } = input;
    const row = { ...existing, ...data, updatedAt: new Date(1) };
    this.rows.set(row.id, row);
    return row;
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

  async findRunConfigs(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioRunConfig[]> {
    return [...this.rows.values()]
      .filter((row) => input.ids.includes(row.id) && row.projectId === input.projectId)
      .map(({ id, name, situation, criteria, parameters }) => ({
        id,
        name,
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

    expect(
      await service.tryGetById({ id: "scenario_1", projectId: "project-b" }),
    ).toBeNull();
    await expect(
      service.getById({ id: "scenario_1", projectId: "project-b" }),
    ).rejects.toBeInstanceOf(ScenarioNotFoundError);
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
            situation: "A customer asks for help",
            criteria: [],
            parameters: [{ name: "region", defaultValue: "eu" }],
          },
        ],
        values: { accountTier: "platinum" },
      }),
    ).rejects.toMatchObject({ code: "scenario_parameter_unknown" });
  });

  it("archives valid batch members while reporting missing members independently", async () => {
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
      service.batchArchive({
        projectId: "project-a",
        ids: ["scenario_1", "scenario_missing"],
      }),
    ).resolves.toMatchObject({
      archived: ["scenario_1"],
      failed: [{ id: "scenario_missing" }],
    });
    await expect(service.list({ projectId: "project-a" })).resolves.toEqual([]);
  });
});
