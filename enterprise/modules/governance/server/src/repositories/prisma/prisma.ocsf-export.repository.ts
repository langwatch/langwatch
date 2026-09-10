import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { GovernanceOcsfExportRepository } from "../audit/governance-setup-state.repository.ts";

const GOVERNANCE_PROJECT_KIND = "internal_governance";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type GovernanceOcsfExportDatabase = Pick<PrismaClient, "project">;

export class PrismaGovernanceOcsfExportRepository extends GovernanceOcsfExportRepository {
  private constructor(private readonly prisma: GovernanceOcsfExportDatabase) {
    super();
  }

  static create(database: GovernanceOcsfExportDatabase): PrismaGovernanceOcsfExportRepository {
    return new PrismaGovernanceOcsfExportRepository(database);
  }

  async findGovernanceTenantId(organizationId: string): Promise<string | null> {
    const project = await this.prisma.project.findFirst({
      where: {
        kind: GOVERNANCE_PROJECT_KIND,
        team: { organizationId },
        archivedAt: null,
      },
      select: { id: true },
    });
    return project?.id ?? null;
  }
}
