import { PricingModel } from "@langwatch/entitlement-contract";
import type { UsageUnit } from "@langwatch/entitlement-contract";

export const USAGE_UNIT_DISPLAY_LABELS: Record<UsageUnit, string> = {
  traces: "Monthly Traces",
  events: "Monthly Events",
} as const;
export interface MeterDecision {
  usageUnit: UsageUnit;
  reason: string;
}

export function resolveUsageMeter({
  pricingModel,
  licenseUsageUnit,
  hasValidLicenseOverride,
  isFree,
}: {
  pricingModel: PricingModel | null;
  licenseUsageUnit?: string;
  hasValidLicenseOverride: boolean;
  isFree: boolean;
}): MeterDecision {
  const usageUnit = resolveUsageUnit({
    pricingModel,
    licenseUsageUnit,
    hasValidLicenseOverride,
    isFree,
  });
  const reason = buildReason({
    usageUnit,
    hasValidLicenseOverride,
    licenseUsageUnit,
    pricingModel,
    isFree,
  });
  return { usageUnit, reason };
}
export function normalizeUsageUnit(raw: string): UsageUnit {
  const normalized = raw.toLowerCase().trim();
  return normalized === "events" || normalized === "event" ? "events" : "traces";
}
function resolveUsageUnit({
  pricingModel,
  licenseUsageUnit,
  hasValidLicenseOverride,
  isFree,
}: {
  pricingModel: PricingModel | null;
  licenseUsageUnit?: string;
  hasValidLicenseOverride: boolean;
  isFree: boolean;
}): UsageUnit {
  if (hasValidLicenseOverride && licenseUsageUnit) return normalizeUsageUnit(licenseUsageUnit);
  if (pricingModel === PricingModel.SEAT_EVENT || isFree) return "events";
  return "traces";
}
function buildReason({
  usageUnit,
  hasValidLicenseOverride,
  licenseUsageUnit,
  pricingModel,
  isFree,
}: {
  usageUnit: UsageUnit;
  hasValidLicenseOverride: boolean;
  licenseUsageUnit?: string;
  pricingModel: PricingModel | null;
  isFree: boolean;
}): string {
  let unitSource: string;
  if (hasValidLicenseOverride && licenseUsageUnit) unitSource = `license(${licenseUsageUnit})`;
  else if (isFree && pricingModel !== PricingModel.SEAT_EVENT) unitSource = "freeTier";
  else unitSource = `pricingModel(${pricingModel ?? "null"})`;
  return `unit=${usageUnit} from ${unitSource}, isFree=${isFree}`;
}
