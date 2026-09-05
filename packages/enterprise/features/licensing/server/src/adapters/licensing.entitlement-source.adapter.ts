import {
  floorAtOssBaseline,
  type EntitlementSource,
  type LicensingService,
  type ResolvePlanInput,
} from "@langwatch/enterprise-licensing-contract";
import type { LicenseCryptographyPort } from "../ports/license-cryptography.port";
import type { OrganizationLicensePort } from "../ports/organization-license.port";
import { LicensePlanSourceService } from "../services/license-plan-source.service";

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
    licenses: OrganizationLicensePort;
    cryptography: LicenseCryptographyPort;
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
