import {
  floorAtOssBaseline,
  type EntitlementSource,
  type LicensingService,
  type ResolvePlanInput,
} from "@langwatch/enterprise-licensing-contract";
import type { LicenseCryptography } from "../app/licensing.members.ts";
import type { OrganizationLicense } from "../app/licensing.members.ts";
import {
  PrismaOrganizationLicenseRepository,
  type OrganizationLicenseDatabase,
} from "../repositories/prisma/prisma.organization-license.repository.ts";
import { NodeLicenseCryptographyAdapter } from "./node-license-cryptography.service.ts";
import { LicensePlanSourceService } from "./license-plan-source.service.ts";

export type LicensingEntitlementSourceAdapterMode = "cloud" | "self-hosted";

/**
 * The two plan questions this source asks, and the whole of what it needs.
 */
export type LicensePlanReader = Pick<LicensingService, "getActivePlan" | "getSelfHostedPlan">;

/**
 * Translates the signed-license lifecycle into Entitlements' neutral source
 * port. Deployment mode is composition, while signature verification remains
 * wholly in the shared Licensing capability.
 */
export class LicensingEntitlementSourceAdapter implements EntitlementSource {
  static create(options: {
    licensing: LicensePlanReader;
    mode: LicensingEntitlementSourceAdapterMode;
  }): LicensingEntitlementSourceAdapter {
    return new LicensingEntitlementSourceAdapter(options.licensing, options.mode);
  }

  /**
   * The whole licence leg of a deployment's plan resolution, in one call.
   */
  static forDeployment(options: {
    licenses: OrganizationLicense;
    cryptography: LicenseCryptography;
    isSaas: boolean;
  }): LicensingEntitlementSourceAdapter {
    return LicensingEntitlementSourceAdapter.create({
      licensing: LicensePlanSourceService.create({
        licenses: options.licenses,
        cryptography: options.cryptography,
      }),
      mode: options.isSaas ? "cloud" : "self-hosted",
    });
  }

  private constructor(
    private readonly licensing: LicensePlanReader,
    private readonly mode: LicensingEntitlementSourceAdapterMode,
  ) {}

  async resolve(input: ResolvePlanInput) {
    if (this.mode === "cloud") {
      return this.licensing.getActivePlan(input.organizationId);
    }

    const plan = await this.licensing.getSelfHostedPlan(input.organizationId);
    return plan.free ? plan : floorAtOssBaseline(plan);
  }
}

/** What a process composition root actually holds, to build a real activated-license source from. */
export type ActivatedLicenseSourceOptions = Readonly<{
  /** Where an organization's activated license key is stored. */
  prisma: OrganizationLicenseDatabase;
  /**
   * The public key a license signature is checked against, where the
   * operator rotated it. Absent uses the licensing contract's own embedded
   * production key.
   */
  licensePublicKey?: string;
  isSaas: boolean;
}>;

/**
 * The whole license leg of a deployment's plan resolution, built from the
 * one thing every process composition root actually holds: its Prisma
 * client. This is the one entry point a composition root calls — it
 * constructs {@link PrismaOrganizationLicenseRepository} and
 * {@link NodeLicenseCryptographyAdapter} internally, so no composition file
 * anywhere names either of them: the typed-Prisma seam and the signature
 * verifier both stay inside this package.
 */
export function createActivatedLicenseSource(
  options: ActivatedLicenseSourceOptions,
): EntitlementSource {
  return LicensingEntitlementSourceAdapter.forDeployment({
    licenses: PrismaOrganizationLicenseRepository.create(options.prisma),
    cryptography: NodeLicenseCryptographyAdapter.create(
      options.licensePublicKey ? { publicKey: options.licensePublicKey } : {},
    ),
    isSaas: options.isSaas,
  });
}
