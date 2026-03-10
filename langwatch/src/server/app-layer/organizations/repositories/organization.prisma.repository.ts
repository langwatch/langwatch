import type { Currency, PrismaClient } from "@prisma/client";
import type { OrganizationRepository } from "./organization.repository";

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrganizationIdByTeamId(teamId: string): Promise<string | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    return team?.organizationId ?? null;
  }

  async getProjectIds(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  async clearTrialLicense(organizationId: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
    });
  }

  async updateCurrency(input: {
    organizationId: string;
    currency: string;
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: input.organizationId },
      data: { currency: input.currency as Currency },
    });
  }
}
