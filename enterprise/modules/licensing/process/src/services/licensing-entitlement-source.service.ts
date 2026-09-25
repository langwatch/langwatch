import {
  floorAtOssBaseline,
  type EntitlementSource,
  type LicensingService,
  type PlanInfo,
  type ResolvePlanInput,
} from "@langwatch/enterprise-licensing-contract";

import type { LicenseCryptography, OrganizationLicense } from "../app/licensing.members.ts";
import { LicensePlanSourceService } from "./license-plan-source.service.ts";

export type LicensingEntitlementSourceMode = "cloud" | "self-hosted";

/**
 * The two plan questions this source asks, and the whole of what it needs.
 */
export type LicensePlanReader = Pick<LicensingService, "getActivePlan" | "getSelfHostedPlan">;

/**
 * Translates the signed-license lifecycle into Entitlements' neutral source
 * port. Deployment mode is composition, while signature verification remains
 * wholly in the shared Licensing capability.
 */
export class LicensingEntitlementSourceService implements EntitlementSource {
  static create(options: {
    licensing: LicensePlanReader;
    mode: LicensingEntitlementSourceMode;
  }): LicensingEntitlementSourceService {
    return new LicensingEntitlementSourceService(options.licensing, options.mode);
  }

  /**
   * The whole licence leg of a deployment's plan resolution, in one call.
   */
  static forDeployment(options: {
    licenses: OrganizationLicense;
    cryptography: LicenseCryptography;
    isSaas: boolean;
  }): LicensingEntitlementSourceService {
    return LicensingEntitlementSourceService.create({
      licensing: LicensePlanSourceService.create({
        licenses: options.licenses,
        cryptography: options.cryptography,
      }),
      mode: options.isSaas ? "cloud" : "self-hosted",
    });
  }

  private constructor(
    private readonly licensing: LicensePlanReader,
    private readonly mode: LicensingEntitlementSourceMode,
  ) {}

  async resolve(input: ResolvePlanInput): Promise<PlanInfo> {
    if (this.mode === "cloud") {
      return this.licensing.getActivePlan(input.organizationId);
    }

    const plan = await this.licensing.getSelfHostedPlan(input.organizationId);
    return plan.free ? plan : floorAtOssBaseline(plan);
  }
}
