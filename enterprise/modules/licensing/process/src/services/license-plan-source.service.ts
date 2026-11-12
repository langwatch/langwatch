import type { LicenseCryptography } from "@langwatch/enterprise-license-signing";
import {
  type LicenseSource,
  UNLIMITED_PLAN,
  mapToPlanInfo,
  type PlanInfo,
} from "@langwatch/enterprise-licensing-contract";
import { HandledError } from "@langwatch/handled-error";

import type { OrganizationLicense } from "../repositories/organization-license.repository.ts";
import { instanceKeyLicensesOrganization } from "../rules/license-key.rules.ts";

/** An organization that no longer exists holds no licence: plan reads answer unlicensed. */
const unlicensedWhenMissing = (error: unknown): { licenseKey: null } => {
  if (HandledError.isHandled(error) && error.code === "organization_not_found")
    return { licenseKey: null };
  throw error;
};

export type LicensePlanSourceOptions = {
  /** Where the organization's activated licence key is read from. */
  licenses: OrganizationLicense;
  /** How a key is parsed, verified and dated. */
  cryptography: LicenseCryptography;
  /** A signed `LANGWATCH_LICENSE_KEY`, which licenses every organization that stored none. */
  instanceLicenseKey?: string | undefined;
};

/** The key an organization runs on, and where it was installed. */
export type ResolvedLicenseKey =
  | { licenseKey: string; source: LicenseSource }
  | { licenseKey: null; source: null };

/**
 * What a signed licence entitles one organization to, in each deployment mode.
 *     signature ONLY (ADR-027: once a customer, never blocked). A term that
 */
export class LicensePlanSourceService {
  static create(options: LicensePlanSourceOptions): LicensePlanSourceService {
    return new LicensePlanSourceService(
      options.licenses,
      options.cryptography,
      options.instanceLicenseKey,
    );
  }

  private constructor(
    private readonly licenses: OrganizationLicense,
    private readonly cryptography: LicenseCryptography,
    private readonly instanceLicenseKey: string | undefined,
  ) {}

  /**
   * The stored key, else the environment key unless it is bound to another
   * organization. A forged environment key still resolves here and is judged by its reader.
   */
  async resolveLicenseKey(organizationId: string): Promise<ResolvedLicenseKey> {
    const { licenseKey } = await this.licenses
      .getOrganizationLicense(organizationId)
      .catch(unlicensedWhenMissing);
    if (licenseKey) return { licenseKey, source: "stored" };
    const instanceKey = this.instanceLicenseKey;
    if (!instanceKey) return { licenseKey: null, source: null };
    const boundOrganizationId = this.cryptography.parseLicenseKey(instanceKey)?.data.organizationId;
    if (!instanceKeyLicensesOrganization({ boundOrganizationId, organizationId }))
      return { licenseKey: null, source: null };
    return { licenseKey: instanceKey, source: "environment" };
  }

  /**
   * The Cloud reading: the stored licence only, signature AND term, so a lapsed
   * contract steps aside and an instance key never overrides a subscription.
   */
  async getActivePlan(organizationId: string): Promise<PlanInfo> {
    const { licenseKey } = await this.licenses
      .getOrganizationLicense(organizationId)
      .catch(unlicensedWhenMissing);
    if (!licenseKey) {
      return UNLIMITED_PLAN;
    }

    const result = this.cryptography.validateLicense({ licenseKey });

    return result.valid ? result.planInfo : UNLIMITED_PLAN;
  }

  /** The self-hosted reading: signature only, so a lapsed licence still holds. */
  async getSelfHostedPlan(organizationId: string): Promise<PlanInfo> {
    const { licenseKey } = await this.resolveLicenseKey(organizationId);
    if (!licenseKey) {
      return UNLIMITED_PLAN;
    }

    const signedLicense = this.cryptography.parseLicenseKey(licenseKey);
    if (!signedLicense || !this.cryptography.verifySignature(signedLicense)) {
      return UNLIMITED_PLAN;
    }

    return mapToPlanInfo(signedLicense.data);
  }
}
