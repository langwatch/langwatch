/**
 * The Postgres bundle. Hand-written rather than `prismaRepositories(...)`
 * because the provider store is read and written through the deployment's own
 * credential codec: the stored `customKeys` format is a wire format shared
 * between processes, so the cipher arrives with the connection.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ModelProviderCredentialCodec } from "../../app/model-provider.members.ts";
import type { ModelProviderRepositories } from "../model-provider.repositories.ts";
import { PrismaModelCostRepository } from "./prisma.model-cost.repository.ts";
import { PrismaModelDefaultRepository } from "./prisma.model-default.repository.ts";
import { PrismaModelProviderEvidenceRepository } from "./prisma.model-provider-evidence.repository.ts";
import { PrismaModelProviderRepository } from "./prisma.model-provider.repository.ts";

export class PostgresModelProviderRepositories {
  static readonly requires = ["prisma", "credentials"] as const;

  static create(
    members: Readonly<{
      prisma: PrismaClient;
      credentials: ModelProviderCredentialCodec;
    }>,
  ): ModelProviderRepositories {
    return {
      providers: PrismaModelProviderRepository.create(
        members.prisma,
        members.credentials,
      ),
      defaults: PrismaModelDefaultRepository.create(members.prisma),
      costs: PrismaModelCostRepository.create(members.prisma),
      evidence: PrismaModelProviderEvidenceRepository.create(members.prisma),
    };
  }
}
