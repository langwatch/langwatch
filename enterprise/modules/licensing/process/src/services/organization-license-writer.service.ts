import type { OrganizationApi } from "@langwatch/organization-contract";

import type {
  OrganizationLicenseRepository,
  StoredLicense,
} from "../repositories/organization-license.repository.ts";

/** Organization still reads its licence columns, so each write lands there too (round 37 D6). */
type OrganizationLicenseColumns = Pick<OrganizationApi, "setLicense" | "clearLicense">;

type LicenseRows = Pick<OrganizationLicenseRepository, "saveLicense" | "clearLicense">;

/**
 * Writes an organization's licence onto licensing's own row and, until
 * organization reads it through LicensingApi, onto organization's columns.
 * Organization's write goes first: it refuses an organization that is gone.
 */
export class OrganizationLicenseWriterService {
  static create(
    deps: Readonly<{ licenses: LicenseRows; organizations: OrganizationLicenseColumns }>,
  ): OrganizationLicenseWriterService {
    return new OrganizationLicenseWriterService(deps.licenses, deps.organizations);
  }

  private constructor(
    private readonly licenses: LicenseRows,
    private readonly organizations: OrganizationLicenseColumns,
  ) {}

  async store({
    organizationId,
    license,
  }: Readonly<{ organizationId: string; license: StoredLicense }>): Promise<void> {
    await this.organizations.setLicense({ organizationId, ...license });
    await this.licenses.saveLicense({ organizationId, license });
  }

  async remove({ organizationId }: Readonly<{ organizationId: string }>): Promise<void> {
    await this.organizations.clearLicense({ organizationId });
    await this.licenses.clearLicense({ organizationId });
  }
}
