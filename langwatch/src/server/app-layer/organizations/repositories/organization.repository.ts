export interface OrganizationRepository {
  getOrganizationIdByTeamId(teamId: string): Promise<string | null>;
  getProjectIds(organizationId: string): Promise<string[]>;
  clearTrialLicense(organizationId: string): Promise<void>;
  updateCurrency(input: {
    organizationId: string;
    currency: string;
  }): Promise<void>;
}

export class NullOrganizationRepository implements OrganizationRepository {
  async getOrganizationIdByTeamId(_teamId: string): Promise<string | null> {
    return null;
  }

  async getProjectIds(_organizationId: string): Promise<string[]> {
    return [];
  }

  async clearTrialLicense(_organizationId: string): Promise<void> {}

  async updateCurrency(_input: {
    organizationId: string;
    currency: string;
  }): Promise<void> {}
}
