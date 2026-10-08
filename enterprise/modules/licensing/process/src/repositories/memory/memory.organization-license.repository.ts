import { OrganizationNotFoundError } from "@langwatch/enterprise-licensing-contract";

import type {
  OrganizationLicenseCandidate,
  OrganizationLicenseRepository,
} from "../organization-license.repository.ts";

/**
 * The licence key on each organization, held in memory: an organization in the
 * map exists, and `null` is an organization with no licence.
 */
export class MemoryOrganizationLicenseRepository implements OrganizationLicenseRepository {
  static create(
    licenses: ReadonlyMap<string, string | null> = new Map(),
  ): MemoryOrganizationLicenseRepository {
    return new MemoryOrganizationLicenseRepository(new Map(licenses));
  }

  private constructor(private readonly licenses: Map<string, string | null>) {}

  async getOrganizationLicense(organizationId: string): Promise<{ licenseKey: string | null }> {
    const licenseKey = this.licenses.get(organizationId);
    if (licenseKey === void 0) throw new OrganizationNotFoundError();
    return { licenseKey };
  }

  async findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]> {
    return [...this.licenses].flatMap(([organizationId, licenseKey]) =>
      licenseKey === null ? [] : [{ organizationId, licenseKey }],
    );
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return this.licenses.has(organizationId);
  }
}
