import type { Prisma, PrismaClient, Scenario } from "@prisma/client";
import { nanoid } from "nanoid";

export type CreateScenarioInput = Omit<
  Prisma.ScenarioUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt" | "archivedAt"
>;

export type UpdateScenarioInput = Partial<
  Omit<CreateScenarioInput, "projectId">
>;

export class ScenarioRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateScenarioInput): Promise<Scenario> {
    return this.prisma.scenario.create({
      data: {
        id: `scen_${nanoid()}`,
        ...input,
      },
    });
  }

  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    return this.prisma.scenario.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        archivedAt: null,
      },
    });
  }

  async findAll(input: { projectId: string }): Promise<Scenario[]> {
    return this.prisma.scenario.findMany({
      where: {
        projectId: input.projectId,
        archivedAt: null,
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async update(
    id: string,
    projectId: string,
    data: UpdateScenarioInput,
  ): Promise<Scenario> {
    return this.prisma.scenario.update({
      where: { id, projectId },
      data,
    });
  }
}
