import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { OrganizationRepositories } from "../organization.repositories.ts";
import { PrismaGroupRepository } from "./prisma.group.repository.ts";
import { PrismaOrganizationMembershipRepository } from "./prisma.organization-membership.repository.ts";
import { PrismaOrganizationRepository } from "./prisma.organization.repository.ts";
import { PrismaPersonalTeamScopeRepository } from "./prisma.personal-team-scope.repository.ts";
import { PrismaTeamRepository } from "./prisma.team.repository.ts";
import { PrismaTenantDirectoryRepository } from "./prisma.tenant-directory.repository.ts";

/** Postgres-backed provider for organization, team, group, and workspace repositories. */
export const PostgresOrganizationRepositories = {
  requires: ["prisma"] as const,
  create: ({ prisma }: { prisma: PrismaClient }): OrganizationRepositories => ({
    organization: PrismaOrganizationRepository.create(prisma),
    team: PrismaTeamRepository.create(prisma),
    group: PrismaGroupRepository.create(prisma),
    membership: (grants) =>
      PrismaOrganizationMembershipRepository.create({ database: prisma, grants }),
    personalTeamScope: PrismaPersonalTeamScopeRepository.bindReader(prisma),
    tenantDirectory: PrismaTenantDirectoryRepository.bindReader(prisma),
  }),
};
