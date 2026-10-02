import { OrganizationNotFoundError } from "@langwatch/enterprise-licensing-contract";

import type {
  OrganizationLicenseCandidate,
  OrganizationLicenseStorage,
  StoredLicense,
} from "../../app/licensing.members.ts";

/**
 * The licence key on each organization, held in memory: an organization in the
 * map exists, and `null` is an organization with no licence. Writes to an unknown
 * organization are refused the way the prisma twin's `update` refuses them.
 */
export class MemoryOrganizationLicenseRepository implements OrganizationLicenseStorage {
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

  async storeLicense(organizationId: string, license: StoredLicense): Promise<void> {
    this.refuseUnknown(organizationId);
    this.licenses.set(organizationId, license.licenseKey);
  }

  async removeLicense(organizationId: string): Promise<void> {
    this.refuseUnknown(organizationId);
    this.licenses.set(organizationId, null);
  }

  private refuseUnknown(organizationId: string): void {
    if (!this.licenses.has(organizationId)) throw new Error(`no organization ${organizationId}`);
  }
}
