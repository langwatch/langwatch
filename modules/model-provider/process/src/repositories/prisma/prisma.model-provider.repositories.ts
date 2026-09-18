/**
 * The Postgres bundle. Hand-written rather than `prismaRepositories(...)` because the provider
 * store's credential codec is built here from the `encryption` member — `requires` may only
 * name `ProcessMembers` keys, and no `"credentials"` entry exists among them.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ModelProviderCredentialCipher } from "../../app/model-provider.members.ts";
import { EncryptedModelProviderCredentialAdapter } from "../../services/encrypted.model-provider-api-key-credential.service.ts";
import type { ModelProviderRepositories } from "../model-provider.repositories.ts";
import { PrismaModelCostRepository } from "./prisma.model-cost.repository.ts";
import { PrismaModelDefaultRepository } from "./prisma.model-default.repository.ts";
import { PrismaModelProviderEvidenceRepository } from "./prisma.model-provider-evidence.repository.ts";
import { PrismaModelProviderRepository } from "./prisma.model-provider.repository.ts";

export class PostgresModelProviderRepositories {
  static readonly requires = ["prisma", "encryption"] as const;

  static create(
    members: Readonly<{
      prisma: PrismaClient;
      encryption: ModelProviderCredentialCipher;
    }>,
  ): ModelProviderRepositories {
    const credentials = EncryptedModelProviderCredentialAdapter.create({
      cipher: members.encryption,
    });
    return {
      providers: PrismaModelProviderRepository.create(members.prisma, credentials),
      defaults: PrismaModelDefaultRepository.create(members.prisma),
      costs: PrismaModelCostRepository.create(members.prisma),
      evidence: PrismaModelProviderEvidenceRepository.create(members.prisma),
    };
  }
}
