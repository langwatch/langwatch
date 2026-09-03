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
 *
 * The two questions are asked on different terms, and the difference is the
 * product's, not an implementation detail:
 *
 *   - **Cloud** treats the licence as a negotiated contract with a TERM. An
 *     expired one stops answering, so the subscription underneath it takes
 *     over rather than a lapsed contract holding a customer on old limits.
 *   - **Self-hosted** treats the licence as proof of purchase, and reads the
 *     signature ONLY (ADR-027: once a customer, never blocked). A term that
 *     ended still names the seats that were bought, because cutting a whole
 *     company's Enterprise surface on a routine upgrade is a blast radius the
 *     product deliberately does not have.
 *
 * Either way, no licence and an unreadable licence answer the same thing —
 * the unlimited baseline — so an unlicensed deployment is never narrowed by
 * this leg and a corrupt key never becomes a smaller plan than none at all.
 *
 * It is separate from {@link LicenseService} because plan resolution needs
 * exactly this and nothing else. The lifecycle service (activation, removal,
 * the status screen, seat counts) composes one of these and delegates, so the
 * screen and the plan provider cannot answer differently.
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
    if (!licenseKey) return UNLIMITED_PLAN;

    const result = this.cryptography.validateLicense({ licenseKey });
    return result.valid ? result.planInfo : UNLIMITED_PLAN;
  }

  /** The self-hosted reading: signature only, so a lapsed licence still holds. */
  async getSelfHostedPlan(organizationId: string): Promise<PlanInfo> {
    const licenseKey = await this.licenses.tryReadLicense(organizationId);
    if (!licenseKey) return UNLIMITED_PLAN;

    const signedLicense = this.cryptography.tryParseLicenseKey(licenseKey);
    if (!signedLicense || !this.cryptography.verifySignature(signedLicense)) {
      return UNLIMITED_PLAN;
    }
    return mapToPlanInfo(signedLicense.data);
  }
}
