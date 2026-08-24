import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  scenarioRunConfigSchema,
  scenarioSchema,
  type Scenario,
  type ScenarioCreateInput,
  type ScenarioReferenceState,
  type ScenarioRunConfig,
  type ScenarioUpdateInput,
} from "@langwatch/scenario-contract";
import { ScenarioRepository } from "../scenario.repository";

export class PrismaScenarioRepository extends ScenarioRepository {
  static create(options: { prisma: PrismaClient }): PrismaScenarioRepository {
    return new PrismaScenarioRepository(options.prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async create(input: ScenarioCreateInput & { id: string }): Promise<Scenario> {
    return scenarioSchema.parse(
      await this.prisma.scenario.create({
        data: {
          ...input,
          parameters: input.parameters ?? undefined,
        },
      }),
    );
  }

  async tryFindById(input: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    const row = await this.prisma.scenario.findFirst({
      where: { ...input, archivedAt: null },
    });
    return row ? scenarioSchema.parse(row) : null;
  }

  async tryFindByIdIncludingArchived(input: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    const row = await this.prisma.scenario.findFirst({ where: input });
    return row ? scenarioSchema.parse(row) : null;
  }

  async findAll(input: { projectId: string }): Promise<Scenario[]> {
    const rows = await this.prisma.scenario.findMany({
      where: { ...input, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((row) => scenarioSchema.parse(row));
  }

  count(input: { projectId: string }): Promise<number> {
    return this.prisma.scenario.count({
      where: { projectId: input.projectId, archivedAt: null },
    });
  }

  async update(input: ScenarioUpdateInput): Promise<Scenario> {
    const { id, projectId, ...data } = input;
    return scenarioSchema.parse(
      await this.prisma.scenario.update({ where: { id, projectId }, data }),
    );
  }

  async tryArchive(input: {
    id: string;
    projectId: string;
    archivedAt: Date;
  }): Promise<Scenario | null> {
    const found = await this.prisma.scenario.findFirst({
      where: { id: input.id, projectId: input.projectId },
      select: { archivedAt: true },
    });
    if (!found) return null;
    return scenarioSchema.parse(
      await this.prisma.scenario.update({
        where: { id: input.id, projectId: input.projectId },
        data: { archivedAt: found.archivedAt ?? input.archivedAt },
      }),
    );
  }

  async findRunConfigs(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioRunConfig[]> {
    const rows = await this.prisma.scenario.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: {
        id: true,
        name: true,
        situation: true,
        criteria: true,
        parameters: true,
      },
    });
    return rows.map((row) => scenarioRunConfigSchema.parse(row));
  }

  async findReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioReferenceState[]> {
    return this.prisma.scenario.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, archivedAt: true },
    });
  }

  async findNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.prisma.scenario.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, name: true },
    });
  }
}
