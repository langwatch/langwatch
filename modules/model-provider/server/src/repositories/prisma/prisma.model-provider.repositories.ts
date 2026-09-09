/**
 * The Postgres bundle. Hand-written rather than `prismaRepositories(...)`
 * because the provider store is read and written through the deployment's own
 * credential codec: the stored `customKeys` format is a wire format shared
 * between processes, so the cipher arrives with the connection.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ModelProviderCredentialCodec } from "../../ports/model-provider.port.ts";
import type { ModelProviderRepositories } from "../model-provider.repositories.ts";
import { PrismaModelCostRepository } from "./prisma.model-cost.repository.ts";
import { PrismaModelDefaultRepository } from "./prisma.model-default.repository.ts";
import { PrismaModelProviderEvidenceRepository } from "./prisma.model-provider-evidence.repository.ts";
import { PrismaModelProviderRepository } from "./prisma.model-provider.repository.ts";

export class PostgresModelProviderRepositories {
  static readonly requires = ["prisma", "credentials"] as const;

  static create(
    infrastructure: Readonly<{
      prisma: PrismaClient;
      credentials: ModelProviderCredentialCodec;
    }>,
  ): ModelProviderRepositories {
    return {
      providers: PrismaModelProviderRepository.create(
        infrastructure.prisma,
        infrastructure.credentials,
      ),
      defaults: PrismaModelDefaultRepository.create(infrastructure.prisma),
      costs: PrismaModelCostRepository.create(infrastructure.prisma),
      evidence: PrismaModelProviderEvidenceRepository.create(infrastructure.prisma),
    };
  }
}
