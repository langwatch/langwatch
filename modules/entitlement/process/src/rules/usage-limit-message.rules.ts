import type { UsageUnit } from "@langwatch/entitlement-contract";
export interface UsageDeployment {
  isSaas: boolean;
  baseHost?: string | undefined;
}
export function buildLimitMessage({
  isFree,
  limit,
  usageUnit,
  deployment,
}: {
  isFree: boolean;
  limit: number;
  usageUnit: UsageUnit;
  deployment: UsageDeployment;
}): string {
  const prefix = isFree ? "Free" : "Monthly";
  return `${prefix} limit of ${limit} ${usageUnit} reached. To increase your limits, ${buildUpgradeUrl(deployment)}`;
}
export function buildUpgradeUrl(deployment: UsageDeployment): string {
  if (deployment.isSaas)
    return "upgrade your plan at https://app.langwatch.ai/settings/subscription";
  const baseHost = deployment.baseHost ?? "https://app.langwatch.ai";
  return `buy a license at ${baseHost}/settings/license`;
}
