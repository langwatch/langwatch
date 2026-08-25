import type { ModelProviderService as ModelProviderServiceContract } from "@langwatch/model-provider-contract";
import {
  ModelProviderCatalog,
  ModelProviderCredentialCodec,
  ModelProviderCredentialPolicy,
  ModelTranslationPort,
  type ManagedProviderService,
  type ModelProviderIdGenerator,
  type ModelProviderAuthorization,
} from "../ports/model-provider.port";
import { PrismaModelCostRepository } from "../repositories/prisma/prisma.model-cost.repository";
import { PrismaModelDefaultRepository } from "../repositories/prisma/prisma.model-default.repository";
import { PrismaModelProviderRepository } from "../repositories/prisma/prisma.model-provider.repository";
import { ModelProviderService } from "../services/model-provider.service";

export interface PostgresModelProviderAdapterOptions {
  database: object;
  catalog: ModelProviderCatalog;
  managedProviders?: ManagedProviderService;
  translation?: ModelTranslationPort;
  generateId?: ModelProviderIdGenerator;
  authorization?: ModelProviderAuthorization;
  credentials: ModelProviderCredentialCodec;
  credentialPolicy: ModelProviderCredentialPolicy;
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
      credentialPolicy: this.options.credentialPolicy,
      defaults: PrismaModelDefaultRepository.create(this.options.database),
      costs: PrismaModelCostRepository.create(this.options.database),
      catalog: this.options.catalog,
      managedProviders: this.options.managedProviders,
      authorization: this.options.authorization,
      translation: this.options.translation,
      generateId: this.options.generateId,
    });
  }
}
