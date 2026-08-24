import {
  ScenarioNotFoundError,
  type Scenario,
  type ScenarioCreateInput,
  type ScenarioReferenceState,
  type ScenarioRunConfig,
  type ScenarioUpdateInput,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";
import { ScenarioRepository } from "../src/repositories/scenario.repository";
import { ScenarioService } from "../src/services/scenario.service";

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
    const service = ScenarioService.create({
      repository,
      generateId: () => "scenario_1",
    });
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
    ).rejects.toBeInstanceOf(ScenarioNotFoundError);
    expect(await service.list({ projectId: "project-a" })).toHaveLength(1);
  });

  it("preserves the first archive timestamp across retry delivery", async () => {
    const repository = new MemoryScenarioRepository();
    const first = new Date("2026-01-01T00:00:00.000Z");
    const later = new Date("2026-01-02T00:00:00.000Z");
    const service = ScenarioService.create({
      repository,
      generateId: () => "scenario_1",
      now: () => first,
    });
    await service.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
    });

    const archived = await service.archive({ id: "scenario_1", projectId: "project-a" });
    const retried = await ScenarioService.create({
      repository,
      generateId: () => "unused",
      now: () => later,
    }).archive({ id: "scenario_1", projectId: "project-a" });

    expect(archived.archivedAt).toEqual(first);
    expect(retried.archivedAt).toEqual(first);
  });
});
