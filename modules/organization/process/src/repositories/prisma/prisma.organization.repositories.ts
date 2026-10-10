import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { OrganizationRepositories } from "../organization.repositories.ts";
import type { OrganizationSettingsCipher } from "../organization.repository.ts";
import { PrismaGroupRepository } from "./prisma.group.repository.ts";
import { PrismaOrganizationInviteRepository } from "./prisma.organization-invite.repository.ts";
import { PrismaOrganizationMembershipRepository } from "./prisma.organization-membership.repository.ts";
import { PrismaOrganizationSeatRepository } from "./prisma.organization-seat.repository.ts";
import { PrismaOrganizationUserDirectoryRepository } from "./prisma.organization-user-directory.repository.ts";
import { PrismaOrganizationRepository } from "./prisma.organization.repository.ts";
import { PrismaPersonalTeamScopeRepository } from "./prisma.personal-team-scope.repository.ts";
import { PrismaScopeGraphRepository } from "./prisma.scope-graph.repository.ts";
import { PrismaSignUpPolicyRepository } from "./prisma.sign-up-policy.repository.ts";
import { PrismaTeamRepository } from "./prisma.team.repository.ts";

/** The organization's Postgres rows; the stored S3 settings are sealed and opened by the cipher. */
export const PostgresOrganizationRepositories = {
  requires: ["prisma", "encryption"] as const,
  create: ({
    prisma,
    encryption,
  }: {
    prisma: PrismaClient;
    encryption: OrganizationSettingsCipher;
  }): Omit<OrganizationRepositories, "inviteRateLimit"> => ({
    organization: PrismaOrganizationRepository.create({ database: prisma, cipher: encryption }),
    team: PrismaTeamRepository.create(prisma),
    group: PrismaGroupRepository.create(prisma),
    membership: (grants) =>
      PrismaOrganizationMembershipRepository.create({
        database: prisma,
        grants,
        cipher: encryption,
      }),
    personalTeamScope: PrismaPersonalTeamScopeRepository.bindReader(prisma),
    scopeGraph: PrismaScopeGraphRepository.create(prisma),
    signUpPolicy: PrismaSignUpPolicyRepository.create(prisma),
    invite: PrismaOrganizationInviteRepository.create({ database: prisma }),
    seats: PrismaOrganizationSeatRepository.create(prisma),
    userDirectory: PrismaOrganizationUserDirectoryRepository.create(prisma),
  }),
};
