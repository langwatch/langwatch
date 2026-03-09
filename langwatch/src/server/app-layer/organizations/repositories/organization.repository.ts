export interface OrganizationRepository {
  getOrganizationIdByTeamId(teamId: string): Promise<string | null>;
  getProjectIds(organizationId: string): Promise<string[]>;
}

export class NullOrganizationRepository implements OrganizationRepository {
  async getOrganizationIdByTeamId(_teamId: string): Promise<string | null> {
    return null;
  }

  async getProjectIds(_organizationId: string): Promise<string[]> {
    return [];
  }
}
