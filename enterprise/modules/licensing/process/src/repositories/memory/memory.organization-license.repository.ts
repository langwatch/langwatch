import type {
  OrganizationLicenseCandidate,
  OrganizationLicenseCandidates,
} from "../../app/licensing.members.ts";

/**
 * The activated licence keys, held per organization. The prisma twin's other
 * read keeps a `try` prefix the linter refuses in new code, so it is not
 * restated here until that rename lands.
 */
export class MemoryOrganizationLicenseRepository implements OrganizationLicenseCandidates {
  static create(
    licenses: ReadonlyMap<string, string> = new Map(),
  ): MemoryOrganizationLicenseRepository {
    return new MemoryOrganizationLicenseRepository(new Map(licenses));
  }

  private constructor(private readonly licenses: Map<string, string>) {}

  activate(organizationId: string, licenseKey: string): void {
    this.licenses.set(organizationId, licenseKey);
  }

  deactivate(organizationId: string): void {
    this.licenses.delete(organizationId);
  }

  async findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]> {
    return [...this.licenses].map(([organizationId, licenseKey]) => ({
      organizationId,
      licenseKey,
    }));
  }
}
