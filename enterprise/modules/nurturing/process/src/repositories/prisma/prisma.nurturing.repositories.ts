// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { prismaRepositories } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NurturingRepositories } from "../nurturing.repositories.ts";
import { PrismaNurturingMilestonesRepository } from "./prisma.nurturing-milestones.repository.ts";
import { PrismaNurturingProjectDirectoryRepository } from "./prisma.nurturing-project-directory.repository.ts";

/** Nurturing's `NurturingOrganization`: the only table it claims. */
const ownedRepositories = prismaRepositories({
  milestones: PrismaNurturingMilestonesRepository,
});

/** Nurturing's own table, and the owners' project rows read through shares without a claim (R40). */
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
