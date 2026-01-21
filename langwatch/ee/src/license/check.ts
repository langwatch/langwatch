import { DEFAULT_PLAN, type SelfHostedPlan } from "./types";

/**
 * Pure function to determine plan from a license key.
 *
 * License key format:
 * - LW-ENT-xxx → self-hosted:enterprise
 * - LW-PRO-xxx → self-hosted:pro
 * - No key or invalid → self-hosted:oss
 *
 * @param licenseKey - The license key to evaluate
 * @returns The corresponding plan
 */
export function determinePlanFromLicenseKey(
  licenseKey: string | undefined
): SelfHostedPlan {
  if (!licenseKey) {
    return DEFAULT_PLAN;
  }

  if (licenseKey.startsWith("LW-ENT-")) {
    return "self-hosted:enterprise";
  }

  if (licenseKey.startsWith("LW-PRO-")) {
    return "self-hosted:pro";
  }

  // Invalid or unrecognized license key format
  return DEFAULT_PLAN;
}

/**
 * Gets the self-hosted plan based on the LICENSE_KEY environment variable.
 *
 * @returns The current self-hosted plan
 */
export function getSelfHostedPlan(): SelfHostedPlan {
  return determinePlanFromLicenseKey(process.env.LICENSE_KEY);
}

/**
 * Checks if Enterprise Edition features are enabled.
 *
 * @returns true if the current plan is enterprise
 */
export function isEeEnabled(): boolean {
  return getSelfHostedPlan() === "self-hosted:enterprise";
}

/**
 * Checks if the current deployment has a paid license (pro or enterprise).
 *
 * @returns true if the plan is pro or enterprise
 */
export function hasPaidLicense(): boolean {
  const plan = getSelfHostedPlan();
  return plan === "self-hosted:pro" || plan === "self-hosted:enterprise";
}
