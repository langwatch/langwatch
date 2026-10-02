import { SsoConnectionNotFoundError } from "@langwatch/identity-contract";

import {
  type LegacySsoOrganization,
  LegacySsoOrganizationRepository,
} from "../legacy-sso-organization.repository.ts";

type LegacySsoOrganizationRow = LegacySsoOrganization & { ssoDomain: string | null };

/** The legacy columns over rows a test seeds. */
export class MemoryLegacySsoOrganizationRepository extends LegacySsoOrganizationRepository {
  static create(
    rows: readonly LegacySsoOrganizationRow[] = [],
  ): MemoryLegacySsoOrganizationRepository {
    return new MemoryLegacySsoOrganizationRepository(rows);
  }

  private constructor(private readonly rows: readonly LegacySsoOrganizationRow[]) {
    super();
  }

  async getLegacySso({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ ssoDomain: string; ssoProvider: string }> {
    const organization = this.rows.find((row) => row.id === organizationId);
    if (!organization?.ssoDomain || !organization.ssoProvider) {
      throw new SsoConnectionNotFoundError(`${organizationId} carries no legacy SSO`);
    }
    return { ssoDomain: organization.ssoDomain, ssoProvider: organization.ssoProvider };
  }

  async findByDomain({ domain }: { domain: string }): Promise<LegacySsoOrganization | null> {
    const organization = this.rows.find((row) => row.ssoDomain === domain);
    return organization
      ? { id: organization.id, name: organization.name, ssoProvider: organization.ssoProvider }
      : null;
  }
}
