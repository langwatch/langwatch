import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ModelProviderRepositories } from "../model-provider.repositories.ts";
import type { ModelProviderCredentialCipher } from "../model-provider.repository.ts";
import { PrismaModelCostRepository } from "./prisma.model-cost.repository.ts";
import { PrismaModelDefaultRepository } from "./prisma.model-default.repository.ts";
import { PrismaModelProviderCredentialMapper } from "./prisma.model-provider-credential.mapper.ts";
import { PrismaModelProviderEvidenceRepository } from "./prisma.model-provider-evidence.repository.ts";
import { PrismaModelProviderRepository } from "./prisma.model-provider.repository.ts";

/** The Postgres stores; the provider store seals and opens credentials with the cipher. */
export class PostgresModelProviderRepositories {
  static create({
    prisma,
    encryption,
  }: Readonly<{
    prisma: PrismaClient;
    encryption: ModelProviderCredentialCipher;
  }>): Omit<ModelProviderRepositories, "rateLimits"> {
    const credentials = PrismaModelProviderCredentialMapper.create({ cipher: encryption });
    return {
      providers: PrismaModelProviderRepository.create(prisma, credentials),
      defaults: PrismaModelDefaultRepository.create(prisma),
      costs: PrismaModelCostRepository.create(prisma),
      evidence: PrismaModelProviderEvidenceRepository.create(prisma),
    };
  }
}
