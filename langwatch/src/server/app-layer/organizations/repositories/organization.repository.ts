import type { OrganizationFeatureName } from "../organization.service";

export interface OrganizationFeatureRow {
  feature: string;
  organizationId: string;
  trialEndDate: Date | null;
}

/**
 * Organization with admin members and their users, used for notification delivery.
 */
export interface OrganizationWithAdmins {
  id: string;
  name: string;
  sentPlanLimitAlert: Date | null;
  members: Array<{
    role: string;
    user: {
      id: string;
      name: string | null;
      email: string | null;
    };
  }>;
}

export interface OrganizationRepository {
  getOrganizationIdByTeamId(teamId: string): Promise<string | null>;
  getProjectIds(organizationId: string): Promise<string[]>;
  getFeature(
    organizationId: string,
    feature: OrganizationFeatureName,
  ): Promise<OrganizationFeatureRow | null>;
  findWithAdmins(
    organizationId: string,
  ): Promise<OrganizationWithAdmins | null>;
  updateSentPlanLimitAlert(
    organizationId: string,
    timestamp: Date,
  ): Promise<void>;
  findProjectsWithName(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>>;
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

  async findWithAdmins(
    _organizationId: string,
  ): Promise<OrganizationWithAdmins | null> {
    return null;
  }

  async updateSentPlanLimitAlert(
    _organizationId: string,
    _timestamp: Date,
  ): Promise<void> {
    // no-op
  }

  async findProjectsWithName(
    _organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return [];
  }
}
