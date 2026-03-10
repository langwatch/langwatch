import type { PrismaClient } from "@prisma/client";
import { traced } from "../tracing";
import { PrismaOrganizationRepository } from "./repositories/organization.prisma.repository";
import {
  NullOrganizationRepository,
  type OrganizationRepository,
  type OrganizationWithAdmins,
} from "./repositories/organization.repository";

export type OrganizationFeatureName = "billable_events_usage";

/**
 * Organization-level queries: feature checks, project lookups, org-from-team resolution.
 */
export class OrganizationService {
  private constructor(private readonly repo: OrganizationRepository) {}

  static create(prisma: PrismaClient | null): OrganizationService {
    const repo = prisma
      ? new PrismaOrganizationRepository(prisma)
      : new NullOrganizationRepository();
    return traced(new OrganizationService(repo), "OrganizationService");
  }

  async getOrganizationIdByTeamId(teamId: string): Promise<string | null> {
    return this.repo.getOrganizationIdByTeamId(teamId);
  }

  async getProjectIds(organizationId: string): Promise<string[]> {
    return this.repo.getProjectIds(organizationId);
  }

  async isFeatureEnabled(
    organizationId: string,
    feature: OrganizationFeatureName,
  ): Promise<boolean> {
    const row = await this.repo.getFeature(organizationId, feature);
    if (!row) return false;
    if (row.trialEndDate && new Date(row.trialEndDate) <= new Date()) {
      return false;
    }
    return true;
  }

  async findWithAdmins(
    organizationId: string,
  ): Promise<OrganizationWithAdmins | null> {
    return this.repo.findWithAdmins(organizationId);
  }

  async updateSentPlanLimitAlert(
    organizationId: string,
    timestamp: Date,
  ): Promise<void> {
    return this.repo.updateSentPlanLimitAlert(organizationId, timestamp);
  }

  async findProjectsWithName(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.repo.findProjectsWithName(organizationId);
  }
}
