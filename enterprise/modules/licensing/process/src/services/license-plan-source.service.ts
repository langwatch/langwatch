import type { LicenseCryptography } from "@langwatch/enterprise-license-signing";
import {
  UNLIMITED_PLAN,
  mapToPlanInfo,
  type LicenseData,
  type PlanInfo,
} from "@langwatch/enterprise-licensing-contract";
import { HandledError } from "@langwatch/handled-error";
import { nowInstant, type Instant } from "@langwatch/time";

import type { OrganizationLicense } from "../repositories/organization-license.repository.ts";
import { isTestingLicense, testingLicenseVerdict } from "../rules/testing-license.rules.ts";

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
  /** `LicensingApi.getInstanceId`; where none is wired, every testing licence is refused. */
  instanceId?: () => Promise<string>;
  /** `LANGWATCH_CONNECT_INSTANCE_ID` is set: every testing licence is refused (ADR-180). */
  instanceIdOverridden?: boolean;
  now?: () => Instant;
};

/**
 * What a signed licence entitles one organization to, in each deployment mode.
 *     signature ONLY (ADR-027: once a customer, never blocked). A term that
 */
export class LicensePlanSourceService {
  static create(options: LicensePlanSourceOptions): LicensePlanSourceService {
    return new LicensePlanSourceService({
      licenses: options.licenses,
      cryptography: options.cryptography,
      instanceId: options.instanceId,
      instanceIdOverridden: options.instanceIdOverridden ?? false,
      now: options.now ?? nowInstant,
    });
  }

  private readonly licenses: OrganizationLicense;
  private readonly cryptography: LicenseCryptography;
  private readonly instanceId: (() => Promise<string>) | undefined;
  private readonly instanceIdOverridden: boolean;
  private readonly now: () => Instant;

  private constructor(parts: {
    licenses: OrganizationLicense;
    cryptography: LicenseCryptography;
    instanceId: (() => Promise<string>) | undefined;
    instanceIdOverridden: boolean;
    now: () => Instant;
  }) {
    this.licenses = parts.licenses;
    this.cryptography = parts.cryptography;
    this.instanceId = parts.instanceId;
    this.instanceIdOverridden = parts.instanceIdOverridden;
    this.now = parts.now;
  }

  /** The Cloud reading: signature AND term, so a lapsed contract steps aside. */
  async getActivePlan(organizationId: string): Promise<PlanInfo> {
    const { licenseKey } = await this.licenses
      .getOrganizationLicense(organizationId)
      .catch(unlicensedWhenMissing);
    if (!licenseKey) {
      return UNLIMITED_PLAN;
    }

    const result = this.cryptography.validateLicense({ licenseKey });
    if (!result.valid) return UNLIMITED_PLAN;

    return (await this.honours({ license: result.licenseData, organizationId }))
      ? result.planInfo
      : UNLIMITED_PLAN;
  }

  /** The self-hosted reading: signature only, so a lapsed licence still holds. */
  async getSelfHostedPlan(organizationId: string): Promise<PlanInfo> {
    const { licenseKey } = await this.licenses
      .getOrganizationLicense(organizationId)
      .catch(unlicensedWhenMissing);
    if (!licenseKey) {
      return UNLIMITED_PLAN;
    }

    const signedLicense = this.cryptography.parseLicenseKey(licenseKey);
    if (!signedLicense || !this.cryptography.verifySignature(signedLicense)) {
      return UNLIMITED_PLAN;
    }
    // A testing licence holds only unexpired, here, for this organization (ADR-180 section 4).
    if (!(await this.honours({ license: signedLicense.data, organizationId }))) {
      return UNLIMITED_PLAN;
    }

    return mapToPlanInfo(signedLicense.data);
  }

  /** A standard licence is always honoured here; it never asks for the instance id. */
  private async honours({
    license,
    organizationId,
  }: {
    license: LicenseData;
    organizationId: string;
  }): Promise<boolean> {
    if (!isTestingLicense(license)) return true;
    const instanceId = await this.instanceId?.().catch(() => undefined);
    return testingLicenseVerdict({
      license,
      instanceId,
      instanceIdOverridden: this.instanceIdOverridden,
      organizationId,
      now: this.now(),
    }).honoured;
  }
}
