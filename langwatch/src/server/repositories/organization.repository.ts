import type { PricingModel, PrismaClient } from "@prisma/client";

/**
 * Repository for organization-related data access
 */
export class OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Gets all project IDs for an organization
   */
  async getProjectIds(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  /**
   * Gets organizationId from teamId
   */
  async getOrganizationIdByTeamId(teamId: string): Promise<string | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    return team?.organizationId ?? null;
  }

  /**
   * Gets the pricing model for an organization
   */
  async getPricingModel(organizationId: string): Promise<PricingModel | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return org?.pricingModel ?? null;
  }
}
