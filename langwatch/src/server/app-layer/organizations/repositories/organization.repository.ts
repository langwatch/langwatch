import type { OrganizationFeatureName } from "../organization.service";

export interface OrganizationFeatureRow {
  feature: string;
  organizationId: string;
  trialEndDate: Date | null;
}

export interface OrganizationRepository {
  getOrganizationIdByTeamId(teamId: string): Promise<string | null>;
  getProjectIds(organizationId: string): Promise<string[]>;
  getFeature(
    organizationId: string,
    feature: OrganizationFeatureName,
  ): Promise<OrganizationFeatureRow | null>;
}

export class NullOrganizationRepository implements OrganizationRepository {
  async getOrganizationIdByTeamId(_teamId: string): Promise<string | null> {
    return null;
  }

  async getProjectIds(_organizationId: string): Promise<string[]> {
    return [];
  }

  async getFeature(
    _organizationId: string,
    _feature: OrganizationFeatureName,
  ): Promise<OrganizationFeatureRow | null> {
    return null;
  }
}
