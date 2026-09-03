import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ModelCostProjectPort } from "../ports/model-provider.port";
import { PrismaModelCostRepository } from "../repositories/prisma/prisma.model-cost.repository";
import { ModelCostCatalogService } from "../services/model-cost-catalog.service";
import { ModelProviderProjectScopeService } from "../services/model-provider-project-scope.service";

/** The one model the cost listing needs from the client. */
export type ModelCostCatalogDatabase = Pick<PrismaClient, "customLLMModelCost">;

/**
 * A project's own model cost rules, composed from one Prisma client and one
 * project read.
 *
 * A background process that folds spans prices each LLM call against the rates
 * the customer stored, and the rates are scoped to the project, its team and
 * its organization. Reaching them through `ModelProviderService` meant
 * composing nine collaborators — an organization service, an authz service, a
 * provider catalog, a translation port, an id service, a credential codec, a
 * Codex token refresher and a connection rate limiter — for a read that asks
 * none of them anything.
 *
 * The object it builds satisfies Trace's `TraceModelCostCatalogPort`.
 * `ModelProviderService` satisfies it as well, because it composes this same
 * service and delegates to it, which is what keeps the application's own
 * compositions compiling unchanged and what keeps the two processes pricing
 * from one implementation rather than two.
 */
export class PostgresModelCostCatalogAdapter {
  static create(options: {
    database: ModelCostCatalogDatabase;
    projects: ModelCostProjectPort;
  }): PostgresModelCostCatalogAdapter {
    return new PostgresModelCostCatalogAdapter(options.database, options.projects);
  }

  private constructor(
    private readonly database: ModelCostCatalogDatabase,
    private readonly projects: ModelCostProjectPort,
  ) {}

  build(): ModelCostCatalogService {
    return ModelCostCatalogService.create({
      costs: PrismaModelCostRepository.create(this.database),
      scopes: ModelProviderProjectScopeService.create({ projects: this.projects }),
    });
  }
}
