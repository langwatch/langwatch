// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { prismaRepositories } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NurturingRepositories } from "../nurturing.repositories.ts";
import { PrismaNurturingErasedUserRepository } from "./prisma.nurturing-erased-user.repository.ts";
import { PrismaNurturingEvaluationDayRepository } from "./prisma.nurturing-evaluation-day.repository.ts";
import { PrismaNurturingVirtualKeyRepository } from "./prisma.nurturing-gateway-key.repository.ts";
import { PrismaNurturingMilestonesRepository } from "./prisma.nurturing-milestones.repository.ts";
import { PrismaNurturingOrganizationCreatedRepository } from "./prisma.nurturing-organization-created.repository.ts";
import { PrismaNurturingOrganizationMemberRepository } from "./prisma.nurturing-organization-member.repository.ts";
import { PrismaNurturingOrganizationPlanRepository } from "./prisma.nurturing-organization-plan.repository.ts";
import { PrismaNurturingPersonalProjectRepository } from "./prisma.nurturing-personal-project.repository.ts";
import { PrismaNurturingProjectDirectoryRepository } from "./prisma.nurturing-project-directory.repository.ts";
import { PrismaNurturingProjectPlacementRepository } from "./prisma.nurturing-project-placement.repository.ts";
import { PrismaNurturingProjectUsageRepository } from "./prisma.nurturing-project-usage.repository.ts";
import { PrismaNurturingTraceDayRepository } from "./prisma.nurturing-trace-day.repository.ts";
import { PrismaNurturingTracedProjectRepository } from "./prisma.nurturing-traced-project.repository.ts";

/**
 * Nurturing's own tables: its organizations, usage view, trace and evaluation days, erasure marks,
 * and its copies of project placements, organization creations, members, plans, gateway keys,
 * personal owners and traced projects. The copies that read the marks each read them over the same
 * client, so they share them as the table does.
 */
const ownedRepositories = prismaRepositories({
  milestones: PrismaNurturingMilestonesRepository,
  erasedUsers: PrismaNurturingErasedUserRepository,
  projectUsage: PrismaNurturingProjectUsageRepository,
  traceDays: PrismaNurturingTraceDayRepository,
  evaluationDays: PrismaNurturingEvaluationDayRepository,
  placements: PrismaNurturingProjectPlacementRepository,
  organizationsCreated: PrismaNurturingOrganizationCreatedRepository,
  members: PrismaNurturingOrganizationMemberRepository,
  plans: PrismaNurturingOrganizationPlanRepository,
  virtualKeys: PrismaNurturingVirtualKeyRepository,
  personalProjects: PrismaNurturingPersonalProjectRepository,
  tracedProjects: PrismaNurturingTracedProjectRepository,
});

/** Nurturing's own tables, and the owners' project rows read through shares without a claim (R40). */
export class PostgresNurturingRepositories {
  static readonly requires = ownedRepositories.requires;
  static readonly repositories = ownedRepositories.repositories;

  static create({
    prisma,
  }: Readonly<{ prisma: PrismaClient }>): Omit<NurturingRepositories, "claims"> {
    return {
      ...ownedRepositories.create({ prisma }),
      projects: PrismaNurturingProjectDirectoryRepository.create({ prisma }),
    };
  }
}
