import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { OrganizationRepositories } from "../organization.repositories.ts";
import { PrismaGroupRepository } from "./prisma.group.repository.ts";
import { PrismaOrganizationRepository } from "./prisma.organization.repository.ts";
import { PrismaTeamRepository } from "./prisma.team.repository.ts";

/**
 * The Postgres-backed provider for the organization module's own repositories
 * (`Organization`, `Team`, `Group`). Written directly against the registry's
 * provider shape rather than `prismaRepositories()`: these repositories still
 * read `Project` (the personal workspace) and `OrganizationUser` (team
 * membership) directly, which are not this feature's exclusive claim yet, so
 * declaring `tables` ownership here would be premature.
 */
export const PostgresOrganizationRepositories = {
  requires: ["prisma"] as const,
  create: ({ prisma }: { prisma: PrismaClient }): OrganizationRepositories => ({
    organization: PrismaOrganizationRepository.create(prisma),
    team: PrismaTeamRepository.create(prisma),
    group: PrismaGroupRepository.create(prisma),
  }),
};
