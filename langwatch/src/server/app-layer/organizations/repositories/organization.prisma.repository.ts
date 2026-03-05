import type { PrismaClient } from "@prisma/client";
import type { OrganizationFeatureName } from "../organization.service";
import type {
  OrganizationFeatureRow,
  OrganizationRepository,
} from "./organization.repository";

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

  async getFeature(
    organizationId: string,
    feature: OrganizationFeatureName,
  ): Promise<OrganizationFeatureRow | null> {
    return this.prisma.organizationFeature.findUnique({
      where: {
        feature_organizationId: { feature, organizationId },
      },
    });
  }
}
