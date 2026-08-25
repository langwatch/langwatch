import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { GovernanceOcsfExportRepository } from "../../ports/ocsf-export.port";

const GOVERNANCE_PROJECT_KIND = "internal_governance";

export class PrismaGovernanceOcsfExportRepository extends GovernanceOcsfExportRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(database: object): PrismaGovernanceOcsfExportRepository {
    return new PrismaGovernanceOcsfExportRepository(database as PrismaClient);
  }

  async tryResolveGovernanceTenantId(
    organizationId: string,
  ): Promise<string | null> {
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
