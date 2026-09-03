import {
  floorAtOssBaseline,
  type EntitlementSource,
  type LicensingService,
  type ResolvePlanInput,
} from "@langwatch/enterprise-licensing-contract";
import type { LicenseCryptographyPort } from "../ports/license-cryptography.port";
import type { OrganizationLicensePort } from "../ports/organization-license.port";
import { LicensePlanSourceService } from "../services/license-plan-source.service";

export type LicensingEntitlementSourceMode = "cloud" | "self-hosted";

/**
 * The two plan questions this source asks, and the whole of what it needs.
 *
 * Narrower than {@link LicensingService} on purpose: activation, removal and
 * the status screen are the lifecycle service's, and requiring them here would
 * make a process that only resolves plans compose seat counts it never reads.
 * Both {@link LicensePlanSourceService} and the full `LicenseService` satisfy
 * it, so nothing that already passed one stops.
 */
export type LicensePlanReader = Pick<LicensingService, "getActivePlan" | "getSelfHostedPlan">;

/**
 * Translates the signed-license lifecycle into Entitlements' neutral source
 * port. Deployment mode is composition, while signature verification remains
 * wholly in the shared Licensing capability.
 */
export class LicensingEntitlementSource implements EntitlementSource {
  static create(options: {
    licensing: LicensePlanReader;
    mode: LicensingEntitlementSourceMode;
  }): LicensingEntitlementSource {
    return new LicensingEntitlementSource(options.licensing, options.mode);
  }

  /**
   * The whole licence leg of a deployment's plan resolution, in one call.
   *
   * Both processes that resolve a plan compose it — `composeApiPlanProvider`
   * and `createWorkerPlanProvider` — and the mode is derived HERE rather than
   * at either root, because it is the same `IS_SAAS` both already read and two
   * roots deriving it separately is how the background process starts refusing
   * a capability the screen offers.
   *
   * `@langwatch/enterprise-billing-server`'s `deploymentPlanSources` decides
   * WHICH sources a deployment resolves through, but it cannot build this one:
   * a feature package may not import another feature's implementation, and
   * verification lives in this package. So the source arrives there already
   * built, the way the entitlement service is constructed at each root for the
   * same reason.
   */
  static forDeployment(options: {
    licenses: OrganizationLicensePort;
    cryptography: LicenseCryptographyPort;
    isSaas: boolean;
  }): LicensingEntitlementSource {
    return LicensingEntitlementSource.create({
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

  async resolve(input: ResolvePlanInput) {
    if (this.mode === "cloud") {
      return this.licensing.getActivePlan(input.organizationId);
    }

    const plan = await this.licensing.getSelfHostedPlan(input.organizationId);
    return plan.free ? plan : floorAtOssBaseline(plan);
  }
}
