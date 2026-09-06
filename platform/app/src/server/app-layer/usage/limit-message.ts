import { env } from "~/env.mjs";
import type { UsageUnit } from "./usage-meter-policy";

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
}: {
  isFree: boolean;
  limit: number;
  usageUnit: UsageUnit;
}): string {
  const prefix = isFree ? "Free" : "Monthly";
  const base = `${prefix} limit of ${limit} ${usageUnit} reached`;
  const upgradeUrl = buildUpgradeUrl();

  return `${base}. To increase your limits, ${upgradeUrl}`;
}

/**
 * Returns the upgrade call-to-action based on deployment mode.
 * SaaS: "upgrade your plan at https://app.langwatch.ai/settings/subscription"
 * Self-hosted: "buy a license at {BASE_HOST}/settings/license"
 */
export function buildUpgradeUrl(): string {
  if (env.IS_SAAS) {
    return "upgrade your plan at https://app.langwatch.ai/settings/subscription";
  }

  const baseHost = env.BASE_HOST ?? "https://app.langwatch.ai";
  return `buy a license at ${baseHost}/settings/license`;
}
