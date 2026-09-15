/**
 * The Postgres bundle. Hand-written rather than `prismaRepositories(...)`
 * because these two readers cross tables the organization, role and project
 * features own; entitlement reads them, it does not claim them.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { EntitlementRepositories } from "../entitlement.repositories.ts";
import { PrismaOrganizationSpendRepository } from "./prisma.organization-spend.repository.ts";
import { PrismaUsageMembershipRepository } from "./prisma.usage-membership.repository.ts";

export class PostgresEntitlementRepositories {
  static readonly requires = ["prisma"] as const;

  static create(members: Readonly<{ prisma: PrismaClient }>): EntitlementRepositories {
    return {
      membership: PrismaUsageMembershipRepository.create(members.prisma),
      spend: PrismaOrganizationSpendRepository.create(members.prisma),
    };
  }
}
