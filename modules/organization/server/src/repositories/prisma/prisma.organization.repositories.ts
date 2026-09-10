import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { OrganizationRepositories } from "../organization.repositories.ts";
import { PrismaGroupRepository } from "./prisma.group.repository.ts";
import { PrismaOrganizationMembershipRepository } from "./prisma.organization-membership.repository.ts";
import { PrismaOrganizationRepository } from "./prisma.organization.repository.ts";
import { bindPersonalTeamScopeReader } from "./prisma.personal-team-scope.repository.ts";
import { bindTenantDirectoryReader } from "./prisma.tenant-directory.repository.ts";
import { PrismaTeamRepository } from "./prisma.team.repository.ts";

/**
 * The Postgres-backed provider for the organization module's own repositories
 * (`Organization`, `Team`, `Group`, `OrganizationUser`, plus the two
 * personal-workspace/tenant-routing readers). Written directly against the
 * registry's provider shape rather than `prismaRepositories()`: these
 * repositories still read `Project` (the personal workspace) directly, which
 * is not this feature's exclusive claim yet, so declaring `tables` ownership
 * here would be premature. The membership repository is bound over the AuthZ
 * peer at app creation, so the provider needs the client alone.
 */
export const PostgresOrganizationRepositories = {
  requires: ["prisma"] as const,
  create: ({ prisma }: { prisma: PrismaClient }): OrganizationRepositories => ({
    organization: PrismaOrganizationRepository.create(prisma),
    team: PrismaTeamRepository.create(prisma),
    group: PrismaGroupRepository.create(prisma),
    membership: (grants) => PrismaOrganizationMembershipRepository.create({ database: prisma, grants }),
    personalTeamScope: bindPersonalTeamScopeReader(prisma),
    tenantDirectory: bindTenantDirectoryReader(prisma),
  }),
};
