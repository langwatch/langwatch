import { featureApi } from "@langwatch/runtime-composition/contract";
import type {
  LicenseStatus,
  PlatformLicenseAccess,
  RemoveLicenseResult,
  StoreLicenseResult,
} from "./license.ts";
import type { PlanInfo } from "./license-plan.ts";

/** The portable signed-license capability supplied to process peers. */
export interface LicensingApi {
  inspectPlatformAccess(input: {
    instanceLicenseKey?: string | undefined;
  }): Promise<PlatformLicenseAccess>;
  getActivePlan(organizationId: string): Promise<PlanInfo>;
  getSelfHostedPlan(organizationId: string): Promise<PlanInfo>;
  validateAndStoreLicense(input: {
    organizationId: string;
    licenseKey: string;
  }): Promise<StoreLicenseResult>;
  getLicenseStatus(organizationId: string): Promise<LicenseStatus>;
  removeLicense(organizationId: string): Promise<RemoveLicenseResult>;
}

export const LicensingApi = featureApi<LicensingApi>("licensing");
