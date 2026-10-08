// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { NON_DESTINATION_PROJECT_KINDS } from "@langwatch/project-contract";

import { BillingProjectDirectoryRepository } from "../billing-project-directory.repository.ts";

/** Only the shared delegate this reader touches; it claims no table (R40). */
type PrismaBillingProjectDatabase = Pick<PrismaClient, "project">;

/** Project's `Project` rows, through the share project declares with billing. */
export class PrismaBillingProjectDirectoryRepository extends BillingProjectDirectoryRepository {
  private constructor(private readonly prisma: PrismaBillingProjectDatabase) {
    super();
  }

  static create(prisma: PrismaBillingProjectDatabase): PrismaBillingProjectDirectoryRepository {
    return new PrismaBillingProjectDirectoryRepository(prisma);
  }

  async findProjectIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { archivedAt: null, team: { organizationId } },
      select: { id: true },
    });

    return projects.map((project) => project.id);
  }

  findProjectsWithName({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.prisma.project.findMany({
      // The governance project's usage stays in the organisation total rather than
      // becoming a line that reveals it; an aggregate holds no usage (ADR-175).
      where: { team: { organizationId }, kind: { notIn: [...NON_DESTINATION_PROJECT_KINDS] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
}
