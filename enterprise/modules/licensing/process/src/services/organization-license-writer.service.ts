import type {
  LicenseColumns,
  OrganizationLicenseRepository,
  StoredLicense,
} from "../repositories/organization-license.repository.ts";
import type { LicensingCustomerFactsService } from "./licensing-customer-facts.service.ts";

type LicenseRows = Pick<
  OrganizationLicenseRepository,
  "findLicense" | "saveLicense" | "clearLicense" | "restoreLicense"
>;

type LicenseFacts = Pick<LicensingCustomerFactsService, "licenseStored" | "licenseCleared">;

/**
 * Writes an organization's licence onto licensing's own row, then records the fact
 * organization mirrors onto its columns (C3-FACT-FIRST). The row goes first: the fact
 * carries only a fingerprint, so organization reads the key from the row (C3-KEY-HASH).
 */
export class OrganizationLicenseWriterService {
  static create(
    deps: Readonly<{ licenses: LicenseRows; facts: LicenseFacts }>,
  ): OrganizationLicenseWriterService {
    return new OrganizationLicenseWriterService(deps.licenses, deps.facts);
  }

  private constructor(
    private readonly licenses: LicenseRows,
    private readonly facts: LicenseFacts,
  ) {}

  async store({
    organizationId,
    license,
  }: Readonly<{ organizationId: string; license: StoredLicense }>): Promise<void> {
    const previous = await this.licenses.findLicense({ organizationId });
    await this.licenses.saveLicense({ organizationId, license });
    await this.tellOrRestore({
      organizationId,
      written: license,
      previous,
      tell: () => this.facts.licenseStored({ organizationId, license }),
    });
  }

  async remove({ organizationId }: Readonly<{ organizationId: string }>): Promise<void> {
    const previous = await this.licenses.findLicense({ organizationId });
    await this.licenses.clearLicense({ organizationId });
    await this.tellOrRestore({
      organizationId,
      written: { licenseKey: null, expiresAt: null, validatedAt: null },
      previous,
      tell: () => this.facts.licenseCleared({ organizationId }),
    });
  }

  /** A refused fact leaves no write behind: the row goes back to what it held (C3-FACT-FAIL). */
  private async tellOrRestore({
    organizationId,
    written,
    previous,
    tell,
  }: Readonly<{
    organizationId: string;
    written: LicenseColumns;
    previous: readonly LicenseColumns[];
    tell: () => Promise<void>;
  }>): Promise<void> {
    try {
      await tell();
    } catch (error) {
      await this.licenses.restoreLicense({
        organizationId,
        written,
        previous: previous[0] ?? null,
      });
      throw error;
    }
  }
}
