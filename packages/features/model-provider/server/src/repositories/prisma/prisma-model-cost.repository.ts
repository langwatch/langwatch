import {
  type CustomLLMModelCost,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  modelCostSchema,
  type ModelCost,
  type ModelDefaultScope,
} from "@langwatch/model-provider-contract";
import { ModelCostRepository } from "../../ports/model-provider.port";

type Database = Pick<PrismaClient, "customLLMModelCost">;

export class PrismaModelCostRepository extends ModelCostRepository {
  private constructor(private readonly database: Database) {
    super();
  }

  static create(database: object): PrismaModelCostRepository {
    if (!isModelCostDatabase(database)) {
      throw new Error("Model Cost repository requires a Prisma database adapter");
    }

    return new PrismaModelCostRepository(database);
  }

  async listForProject(projectScopes: ModelDefaultScope[]): Promise<ModelCost[]> {
    const rows = await this.database.customLLMModelCost.findMany({
      where: {
        OR: projectScopes,
      },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(toCost);
  }

  async tryFindById(id: string): Promise<ModelCost | null> {
    const row = await this.database.customLLMModelCost.findUnique({ where: { id } });

    return row ? toCost(row) : null;
  }

  async save(input: ModelCost): Promise<ModelCost> {
    const row = await this.database.customLLMModelCost.upsert({
      where: { id: input.id },
      create: {
        ...input,
        organizationId: input.organizationId,
        projectId: input.scopeType === "PROJECT" ? input.scopeId : null,
      },
      update: {
        ...input,
        organizationId: input.organizationId,
        projectId: input.scopeType === "PROJECT" ? input.scopeId : null,
      },
    });

    return toCost(row);
  }

  async delete(id: string): Promise<void> {
    await this.database.customLLMModelCost.delete({ where: { id } });
  }
}

function isModelCostDatabase(database: object): database is Database {
  return "customLLMModelCost" in database;
}

function toCost(row: CustomLLMModelCost): ModelCost {
  return modelCostSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId ?? null,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    model: row.model,
    regex: row.regex,
    inputCostPerToken: row.inputCostPerToken ?? null,
    outputCostPerToken: row.outputCostPerToken ?? null,
    cacheReadCostPerToken: row.cacheReadCostPerToken ?? null,
    cacheCreationCostPerToken: row.cacheCreationCostPerToken ?? null,
    cacheCreation1hCostPerToken: row.cacheCreation1hCostPerToken ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
