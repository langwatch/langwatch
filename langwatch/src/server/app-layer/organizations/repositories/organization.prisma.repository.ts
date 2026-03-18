import type { Currency, PrismaClient } from "@prisma/client";
import type { OrganizationFeatureName } from "../organization.service";
import type {
  OrganizationFeatureRow,
  OrganizationRepository,
  OrganizationWithAdmins,
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

  async findWithAdmins(
    organizationId: string,
  ): Promise<OrganizationWithAdmins | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        members: {
          where: { role: "ADMIN" },
          include: {
            user: true,
          },
        },
      },
    }) as Promise<OrganizationWithAdmins | null>;
  }

  async updateSentPlanLimitAlert(
    organizationId: string,
    timestamp: Date,
  ): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { sentPlanLimitAlert: timestamp },
    });
  }

  async findProjectsWithName(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
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

  async getPricingModel(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return org?.pricingModel ?? null;
  }

  async getStripeCustomerId(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });
    return org?.stripeCustomerId ?? null;
  }

  async findNameById(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    return org ?? null;
  }
}
