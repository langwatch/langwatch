// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { prismaRepositories } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NurturingRepositories } from "../nurturing.repositories.ts";
import { PrismaNurturingMilestonesRepository } from "./prisma.nurturing-milestones.repository.ts";
import { PrismaNurturingOrganizationCreatedRepository } from "./prisma.nurturing-organization-created.repository.ts";
import { PrismaNurturingOrganizationMemberRepository } from "./prisma.nurturing-organization-member.repository.ts";
import { PrismaNurturingPersonalProjectRepository } from "./prisma.nurturing-personal-project.repository.ts";
import { PrismaNurturingProjectDirectoryRepository } from "./prisma.nurturing-project-directory.repository.ts";
import { PrismaNurturingProjectPlacementRepository } from "./prisma.nurturing-project-placement.repository.ts";
import { PrismaNurturingProjectUsageRepository } from "./prisma.nurturing-project-usage.repository.ts";
import { PrismaNurturingTraceDayRepository } from "./prisma.nurturing-trace-day.repository.ts";
import { PrismaNurturingTracedProjectRepository } from "./prisma.nurturing-traced-project.repository.ts";
import { PrismaNurturingUncopiedProjectRepository } from "./prisma.nurturing-uncopied-project.repository.ts";

/**
 * Nurturing's own tables: its organizations, usage view, trace days, and its copies of project
 * placements, organization creations, members, personal owners and traced projects, and the
 * projects it saw with no placement copy.
 */
const ownedRepositories = prismaRepositories({
  milestones: PrismaNurturingMilestonesRepository,
  projectUsage: PrismaNurturingProjectUsageRepository,
  traceDays: PrismaNurturingTraceDayRepository,
  placements: PrismaNurturingProjectPlacementRepository,
  organizationsCreated: PrismaNurturingOrganizationCreatedRepository,
  members: PrismaNurturingOrganizationMemberRepository,
  personalProjects: PrismaNurturingPersonalProjectRepository,
  tracedProjects: PrismaNurturingTracedProjectRepository,
  uncopiedProjects: PrismaNurturingUncopiedProjectRepository,
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
