// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { prismaRepositories } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NurturingRepositories } from "../nurturing.repositories.ts";
import { PrismaNurturingMilestonesRepository } from "./prisma.nurturing-milestones.repository.ts";
import { PrismaNurturingPersonalProjectRepository } from "./prisma.nurturing-personal-project.repository.ts";
import { PrismaNurturingProjectDirectoryRepository } from "./prisma.nurturing-project-directory.repository.ts";
import { PrismaNurturingTracedProjectRepository } from "./prisma.nurturing-traced-project.repository.ts";

/** Nurturing's own tables: its organizations and its copies of personal owners and traced projects. */
const ownedRepositories = prismaRepositories({
  milestones: PrismaNurturingMilestonesRepository,
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
