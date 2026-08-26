import type { ModelProviderService as ModelProviderServiceContract } from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import {
  ModelProviderCatalog,
  ModelProviderCredentialCodec,
  CodexTokenRefresher,
  ModelProviderConnectionRateLimiter,
  ModelTranslationPort,
  type ModelProviderIdService,
} from "../ports/model-provider.port";
import { PrismaModelCostRepository } from "../repositories/prisma/prisma-model-cost.repository";
import { PrismaModelDefaultRepository } from "../repositories/prisma/prisma-model-default.repository";
import { PrismaModelProviderRepository } from "../repositories/prisma/prisma-model-provider.repository";
import { ModelProviderService } from "../services/model-provider.service";
import { ModelProviderKeysService } from "../services/model-provider-keys.service";

export interface PostgresModelProviderAdapterOptions {
  database: object;
  projects: ProjectService;
  organizations: OrganizationService;
  catalog: ModelProviderCatalog;
  translation: ModelTranslationPort;
  ids: ModelProviderIdService;
  authorization: AuthzService;
  credentials: ModelProviderCredentialCodec;
  codexTokenRefresher: CodexTokenRefresher;
  connectionRateLimiter: ModelProviderConnectionRateLimiter;
}

/** Composes the public Model Provider service with its private Postgres adapters. */
export class PostgresModelProviderAdapter {
  private constructor(private readonly options: PostgresModelProviderAdapterOptions) {}

  static create(
    options: PostgresModelProviderAdapterOptions,
  ): PostgresModelProviderAdapter {
    return new PostgresModelProviderAdapter(options);
  }

  build(): ModelProviderServiceContract {
    return ModelProviderService.create({
      repository: PrismaModelProviderRepository.create(
        this.options.database,
        this.options.credentials,
      ),
      projects: this.options.projects,
      organizations: this.options.organizations,
      credentialPolicy: ModelProviderKeysService.create(),
      codexTokenRefresher: this.options.codexTokenRefresher,
      connectionRateLimiter: this.options.connectionRateLimiter,
      defaults: PrismaModelDefaultRepository.create(this.options.database),
      costs: PrismaModelCostRepository.create(this.options.database),
      catalog: this.options.catalog,
      authorization: this.options.authorization,
      translation: this.options.translation,
      ids: this.options.ids,
    });
  }
}
