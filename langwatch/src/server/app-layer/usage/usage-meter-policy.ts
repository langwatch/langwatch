import { PricingModel } from "@prisma/client";

export type UsageUnit = "traces" | "events";

export type MeterBackend = "clickhouse" | "elasticsearch";

export interface MeterDecision {
  usageUnit: UsageUnit;
  backend: MeterBackend;
  reason: string;
}

/**
 * Resolves which counting unit and backend to use for usage metering.
 *
 * Precedence:
 *   1. License override with explicit usageUnit → use that unit
 *   2. PricingModel SEAT_EVENT → always events
 *   3. Free tier (isFree=true) → events regardless of pricing model
 *   4. Paid non-SEAT_EVENT → traces
 *   5. Backend: ClickHouse preferred, ElasticSearch fallback
 *
 * This is a pure decision function — no side effects, no I/O.
 */
export function resolveUsageMeter({
  pricingModel,
  licenseUsageUnit,
  hasValidLicenseOverride,
  isFree,
  clickhouseAvailable,
}: {
  pricingModel: PricingModel | null;
  licenseUsageUnit?: string;
  hasValidLicenseOverride: boolean;
  isFree: boolean;
  clickhouseAvailable: boolean;
}): MeterDecision {
  // 1. License override with explicit usageUnit
  const usageUnit = resolveUsageUnit({
    pricingModel,
    licenseUsageUnit,
    hasValidLicenseOverride,
    isFree,
  });

  // 2. Backend selection
  const backend: MeterBackend = clickhouseAvailable
    ? "clickhouse"
    : "elasticsearch";

  const reason = buildReason({
    usageUnit,
    backend,
    hasValidLicenseOverride,
    licenseUsageUnit,
    pricingModel,
    isFree,
  });

  return { usageUnit, backend, reason };
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
  // License override with explicit usageUnit takes precedence
  if (hasValidLicenseOverride && licenseUsageUnit) {
    return normalizeUsageUnit(licenseUsageUnit);
  }

  // PricingModel-derived: SEAT_EVENT → events, else → traces
  if (pricingModel === PricingModel.SEAT_EVENT) {
    return "events";
  }

  // Free-tier always counts events regardless of pricing model
  if (isFree) {
    return "events";
  }

  return "traces";
}

/**
 * Normalizes arbitrary string to a valid UsageUnit.
 * Defensive boundary — licenses may contain unexpected values.
 */
export function normalizeUsageUnit(raw: string): UsageUnit {
  const normalized = raw.toLowerCase().trim();
  if (normalized === "events" || normalized === "event") {
    return "events";
  }
  return "traces";
}

function buildReason({
  usageUnit,
  backend,
  hasValidLicenseOverride,
  licenseUsageUnit,
  pricingModel,
  isFree,
}: {
  usageUnit: UsageUnit;
  backend: MeterBackend;
  hasValidLicenseOverride: boolean;
  licenseUsageUnit?: string;
  pricingModel: PricingModel | null;
  isFree: boolean;
}): string {
  const unitSource = hasValidLicenseOverride && licenseUsageUnit
    ? `license(${licenseUsageUnit})`
    : `pricingModel(${pricingModel ?? "null"})`;

  return `unit=${usageUnit} from ${unitSource}, isFree=${isFree}, backend=${backend}`;
}
