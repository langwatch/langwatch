import { PrismaClient } from "@langwatch/prisma-client/generated";
import { modelCostSchema, type ModelCost } from "@langwatch/model-provider-contract";
import { ModelCostRepository } from "../../ports/model-provider.port";

type Database = Pick<PrismaClient, "customLLMModelCost" | "project" | "team">;

export class PrismaModelCostRepository extends ModelCostRepository {
  private constructor(private readonly database: Database) {
    super();
  }
  static create(database: object): PrismaModelCostRepository {
    return new PrismaModelCostRepository(database as Database);
  }
  async listForProject(projectId: string): Promise<ModelCost[]> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: { teamId: true, team: { select: { organizationId: true } } },
    });
    if (!project) return [];
    const rows = await this.database.customLLMModelCost.findMany({
      where: {
        OR: [
          { scopeType: "PROJECT", scopeId: projectId },
          { scopeType: "TEAM", scopeId: project.teamId },
          { scopeType: "ORGANIZATION", scopeId: project.team.organizationId },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toCost);
  }
  async tryFindById(id: string): Promise<ModelCost | null> {
    const row = await this.database.customLLMModelCost.findUnique({ where: { id } });
    return row ? toCost(row) : null;
  }
  async save(
    input: Omit<ModelCost, "createdAt" | "updatedAt"> & { createdAt?: Date },
  ): Promise<ModelCost> {
    const organizationId =
      input.organizationId.trim() ||
      (await this.tryResolveOrganizationId({
        projectId: input.projectId ?? input.scopeId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      }));
    if (!organizationId)
      throw new Error("Cost scope does not resolve to an organization");
    const row = await this.database.customLLMModelCost.upsert({
      where: { id: input.id },
      create: {
        ...input,
        organizationId,
        projectId: input.scopeType === "PROJECT" ? input.scopeId : null,
      },
      update: {
        ...input,
        organizationId,
        projectId: input.scopeType === "PROJECT" ? input.scopeId : null,
      },
    });
    return toCost(row);
  }
  async delete(id: string): Promise<void> {
    await this.database.customLLMModelCost.delete({ where: { id } });
  }
  async tryResolveOrganizationId(input: {
    projectId: string;
    scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId?: string;
  }): Promise<string | null> {
    if (input.scopeType === "ORGANIZATION" && input.scopeId) return input.scopeId;
    if (input.scopeType === "TEAM" && input.scopeId)
      return (
        (
          await this.database.team.findUnique({
            where: { id: input.scopeId },
            select: { organizationId: true },
          })
        )?.organizationId ?? null
      );
    const projectId =
      input.scopeType === "PROJECT" && input.scopeId ? input.scopeId : input.projectId;
    return (
      (
        await this.database.project.findUnique({
          where: { id: projectId },
          select: { team: { select: { organizationId: true } } },
        })
      )?.team.organizationId ?? null
    );
  }
}
function toCost(row: unknown): ModelCost {
  const value = row as Record<string, unknown>;
  return modelCostSchema.parse({
    id: value.id,
    organizationId: value.organizationId,
    projectId: value.projectId ?? null,
    scopeType: value.scopeType,
    scopeId: value.scopeId,
    model: value.model,
    regex: value.regex,
    inputCostPerToken: value.inputCostPerToken ?? null,
    outputCostPerToken: value.outputCostPerToken ?? null,
    cacheReadCostPerToken: value.cacheReadCostPerToken ?? null,
    cacheCreationCostPerToken: value.cacheCreationCostPerToken ?? null,
    cacheCreation1hCostPerToken: value.cacheCreation1hCostPerToken ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}
