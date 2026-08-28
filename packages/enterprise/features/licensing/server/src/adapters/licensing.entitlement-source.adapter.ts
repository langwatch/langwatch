import {
  floorAtOssBaseline,
  type EntitlementSource,
  type LicensingService,
  type ResolvePlanInput,
} from "@langwatch/enterprise-licensing-contract";

export type LicensingEntitlementSourceMode = "cloud" | "self-hosted";

/**
 * Translates the signed-license lifecycle into Entitlements' neutral source
 * port. Deployment mode is composition, while signature verification remains
 * wholly in the shared Licensing capability.
 */
export class LicensingEntitlementSource implements EntitlementSource {
  static create(options: {
    licensing: LicensingService;
    mode: LicensingEntitlementSourceMode;
  }): LicensingEntitlementSource {
    return new LicensingEntitlementSource(options.licensing, options.mode);
  }

  private constructor(
    private readonly licensing: LicensingService,
    private readonly mode: LicensingEntitlementSourceMode,
  ) {}

  async resolve(input: ResolvePlanInput) {
    if (this.mode === "cloud") {
      return this.licensing.getActivePlan(input.organizationId);
    }

    const plan = await this.licensing.getSelfHostedPlan(input.organizationId);
    return plan.free ? plan : floorAtOssBaseline(plan);
  }
}
