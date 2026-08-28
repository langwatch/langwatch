import type { PlanInfo } from "@langwatch/entitlement-contract";
import type { GenerateLicenseInput, GenerateLicenseOutput } from "./license.commands";
import type {
  LicenseStatus,
  PlatformLicenseAccess,
  RemoveLicenseResult,
  StoreLicenseResult,
} from "./license";

/** The provider-neutral source port Licensing implements for Entitlements. */
export type { EntitlementSource, ResolvePlanInput } from "@langwatch/entitlement-contract";

/** Application-facing capability supplied by the Enterprise license source. */
export abstract class LicensingService {
  abstract inspectPlatformAccess(input: {
    instanceLicenseKey?: string | undefined;
  }): Promise<PlatformLicenseAccess>;
  abstract getActivePlan(organizationId: string): Promise<PlanInfo>;
  abstract getSelfHostedPlan(organizationId: string): Promise<PlanInfo>;
  abstract validateAndStoreLicense(
    organizationId: string,
    licenseKey: string,
  ): Promise<StoreLicenseResult>;
  abstract getLicenseStatus(organizationId: string): Promise<LicenseStatus>;
  abstract removeLicense(organizationId: string): Promise<RemoveLicenseResult>;
}

/** Issuer-side capability; the private key is always supplied explicitly. */
export abstract class LicenseGenerationCapability {
  abstract generate(input: GenerateLicenseInput): GenerateLicenseOutput;
}
