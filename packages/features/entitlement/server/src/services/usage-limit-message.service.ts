import type { UsageUnit } from "@langwatch/entitlement-contract";

/**
 * Builds the human-readable limit message for 429 responses.
 *
 * Format: "{prefix} limit of {limit} {unit} reached. To increase your limits, {action}"
 * - prefix: "Free" for free-tier orgs, "Monthly" for paid orgs
 * - unit: "events" or "traces" based on the meter decision
 * - action: SaaS users are told to upgrade; self-hosted users are told to buy a license
 */
export function buildLimitMessage({
  isFree,
  limit,
  usageUnit,
  deployment,
}: {
  isFree: boolean;
  limit: number;
  usageUnit: UsageUnit;
  /** Which install this is, and where its own settings live. */
  deployment: UsageDeployment;
}): string {
  const prefix = isFree ? "Free" : "Monthly";
  const base = `${prefix} limit of ${limit} ${usageUnit} reached`;
  const upgradeUrl = buildUpgradeUrl(deployment);

  return `${base}. To increase your limits, ${upgradeUrl}`;
}

/**
 * What the message needs to know about the install: whether it is the hosted
 * product, and the origin its own settings pages live at. Both were read off
 * the application's environment; a package reads none, so the composition
 * states them.
 */
export interface UsageDeployment {
  isSaas: boolean;
  baseHost?: string | undefined;
}

/**
 * Returns the upgrade call-to-action based on deployment mode.
 * SaaS: "upgrade your plan at https://app.langwatch.ai/settings/subscription"
 * Self-hosted: "buy a license at {BASE_HOST}/settings/license"
 */
export function buildUpgradeUrl(deployment: UsageDeployment): string {
  if (deployment.isSaas) {
    return "upgrade your plan at https://app.langwatch.ai/settings/subscription";
  }

  const baseHost = deployment.baseHost ?? "https://app.langwatch.ai";
  return `buy a license at ${baseHost}/settings/license`;
}
