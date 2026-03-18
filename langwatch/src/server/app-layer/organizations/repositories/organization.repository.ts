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
  clearTrialLicense(organizationId: string): Promise<void>;
  updateCurrency(input: {
    organizationId: string;
    currency: string;
  }): Promise<void>;
  getPricingModel(organizationId: string): Promise<string | null>;
  getStripeCustomerId(organizationId: string): Promise<string | null>;
  findNameById(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null>;
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

  async clearTrialLicense(_organizationId: string): Promise<void> {}

  async updateCurrency(_input: {
    organizationId: string;
    currency: string;
  }): Promise<void> {}

  async getPricingModel(_organizationId: string): Promise<string | null> {
    return null;
  }

  async getStripeCustomerId(_organizationId: string): Promise<string | null> {
    return null;
  }

  async findNameById(
    _organizationId: string,
  ): Promise<{ id: string; name: string } | null> {
    return null;
  }
}
