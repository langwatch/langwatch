import type { SelfHostedPlan } from "./types";

/**
 * Determines the self-hosted plan based on the LICENSE_KEY environment variable.
 *
 * License key format:
 * - LW-ENT-xxx → self-hosted:enterprise
 * - LW-PRO-xxx → self-hosted:pro
 * - No key or invalid → self-hosted:oss
 *
 * @returns The current self-hosted plan
 */
export function getSelfHostedPlan(): SelfHostedPlan {
  const licenseKey = process.env.LICENSE_KEY;

  if (!licenseKey) {
    return "self-hosted:oss";
  }

  if (licenseKey.startsWith("LW-ENT-")) {
    return "self-hosted:enterprise";
  }

  if (licenseKey.startsWith("LW-PRO-")) {
    return "self-hosted:pro";
  }

  // Invalid or unrecognized license key format
  return "self-hosted:oss";
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
