import {
  UNLIMITED_PLAN,
  mapToPlanInfo,
  type PlanInfo,
} from "@langwatch/enterprise-licensing-contract";
import type { LicenseCryptographyPort } from "../ports/license-cryptography.port";
import type { OrganizationLicensePort } from "../ports/organization-license.port";

export type LicensePlanSourceOptions = {
  /** Where the organization's activated licence key is read from. */
  licenses: OrganizationLicensePort;
  /** How a key is parsed, verified and dated. */
  cryptography: LicenseCryptographyPort;
};

/**
 * What a signed licence entitles one organization to, in each deployment mode.
 *     signature ONLY (ADR-027: once a customer, never blocked). A term that
 */
export class LicensePlanSourceService {
  static create(options: LicensePlanSourceOptions): LicensePlanSourceService {
    return new LicensePlanSourceService(options.licenses, options.cryptography);
  }

  private constructor(
    private readonly licenses: OrganizationLicensePort,
    private readonly cryptography: LicenseCryptographyPort,
  ) {}

  /** The Cloud reading: signature AND term, so a lapsed contract steps aside. */
  async getActivePlan(organizationId: string): Promise<PlanInfo> {
    const licenseKey = await this.licenses.tryReadLicense(organizationId);
    if (!licenseKey) {
      return UNLIMITED_PLAN;
    }

    const result = this.cryptography.validateLicense({ licenseKey });

    return result.valid ? result.planInfo : UNLIMITED_PLAN;
  }

  /** The self-hosted reading: signature only, so a lapsed licence still holds. */
  async getSelfHostedPlan(organizationId: string): Promise<PlanInfo> {
    const licenseKey = await this.licenses.tryReadLicense(organizationId);
    if (!licenseKey) {
      return UNLIMITED_PLAN;
    }

    const signedLicense = this.cryptography.tryParseLicenseKey(licenseKey);
    if (!signedLicense || !this.cryptography.verifySignature(signedLicense)) {
      return UNLIMITED_PLAN;
    }

    return mapToPlanInfo(signedLicense.data);
  }
}
