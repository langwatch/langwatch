import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ModelProviderService as ModelProviderServiceContract } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  ModelProviderCatalog,
  ModelProviderCredentialCodec,
  CodexTokenRefresher,
  ModelProviderConnectionRateLimiter,
  ModelTranslationPort,
  type ModelProviderIdService,
} from "../ports/model-provider.port.ts";
import { PrismaModelCostRepository } from "../repositories/prisma/prisma.model-cost.repository.ts";
import { PrismaModelDefaultRepository } from "../repositories/prisma/prisma.model-default.repository.ts";
import { PrismaModelProviderRepository } from "../repositories/prisma/prisma.model-provider.repository.ts";
import { ModelProviderService } from "./model-provider.service.ts";
import { ModelProviderKeysService } from "./model-provider-keys.service.ts";

export interface PostgresModelProviderAdapterOptions {
  database: PrismaClient;
  projects: ProjectApi;
  organizations: OrganizationApi;
  catalog: ModelProviderCatalog;
  translation: ModelTranslationPort;
  ids: ModelProviderIdService;
  authorization: AuthzApi;
  credentials: ModelProviderCredentialCodec;
  codexTokenRefresher: CodexTokenRefresher;
  connectionRateLimiter: ModelProviderConnectionRateLimiter;
}

/** Composes the public Model Provider service with its private Postgres adapters. */
export class PostgresModelProviderAdapter {
  private constructor(private readonly options: PostgresModelProviderAdapterOptions) {}

  static create(options: PostgresModelProviderAdapterOptions): PostgresModelProviderAdapter {
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
