import { moduleApi } from "@langwatch/runtime-composition";
import type {
  LicenseStatus,
  PlatformLicenseAccess,
  RemoveLicenseResult,
  SsoGateStatus,
  StoreLicenseResult,
} from "./license.ts";
import type { MintLicenseKeyInput, StoreLicenseInput } from "./license.commands.ts";
import type { LimitCheckResult, LimitType } from "./license-limit-type.ts";
import type { PlanInfo } from "./license-plan.ts";

/**
 * The caller, as the enforcement service classifies them: a lite member is
 * counted differently from a full one, and a deployment's operator allow-list
 * is keyed by address, so an id alone cannot answer a limit.
 */
export type LicensingCaller = Readonly<{ id: string; email?: string | null }>;

/** One limit, asked about one organization on behalf of one caller. */
export type LicenseLimitCheck = Readonly<{
  organizationId: string;
  limitType: LimitType;
  user: LicensingCaller;
}>;

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
  /** Why a deployment configured for single sign-on is not using it. */
  getSsoGateStatus(): Promise<SsoGateStatus>;
  /** Validates a pasted key and stores it, answering the plan it grants. */
  uploadLicense(input: StoreLicenseInput): Promise<PlanInfo>;
  /** Mints and signs a key from a private key an operator supplies. */
  mintLicenseKey(input: MintLicenseKeyInput): string;
  /** Whether one limit still admits another resource, for this caller. */
  checkLimit(input: LicenseLimitCheck): Promise<LimitCheckResult>;
  /** Every enforced limit at once, keyed by limit type. */
  checkAllLimits(
    input: Readonly<{ organizationId: string; user: LicensingCaller }>,
  ): Promise<Record<LimitType, LimitCheckResult>>;
  /**
   * A client pre-check refused somebody. The limit is checked again here, so a
   * fabricated report cannot raise an alert nobody can retract.
   */
  reportLimitBlocked(input: LicenseLimitCheck): Promise<void>;
}

export const LicensingApi = moduleApi<LicensingApi>("licensing");
