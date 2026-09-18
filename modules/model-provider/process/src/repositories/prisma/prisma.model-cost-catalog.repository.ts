import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ModelCostProject } from "../../app/model-provider.members.ts";
import { PrismaModelCostRepository } from "./prisma.model-cost.repository.ts";
import { ModelCostCatalogService } from "../../services/model-cost-catalog.service.ts";
import { ModelProviderProjectScopeService } from "../../services/model-provider-project-scope.service.ts";

/** The one model the cost listing needs from the client. */
export type ModelCostCatalogDatabase = Pick<PrismaClient, "customLLMModelCost">;

/**
 * A project's own model cost rules, composed from one Prisma client and one project read,
 * instead of `ModelProviderApi`'s nine collaborators a span-pricing read never needs. Satisfies
 * Trace's `TraceModelCostCatalog`, same as `ModelProviderApi`, which delegates to this service.
 */
export class PrismaModelCostCatalogRepository {
  static create(options: {
    database: ModelCostCatalogDatabase;
    projects: ModelCostProject;
  }): PrismaModelCostCatalogRepository {
    return new PrismaModelCostCatalogRepository(options.database, options.projects);
  }

  private constructor(
    private readonly database: ModelCostCatalogDatabase,
    private readonly projects: ModelCostProject,
  ) {}

  build(): ModelCostCatalogService {
    return ModelCostCatalogService.create({
      costs: PrismaModelCostRepository.create(this.database),
      scopes: ModelProviderProjectScopeService.create({ projects: this.projects }),
    });
  }
}
