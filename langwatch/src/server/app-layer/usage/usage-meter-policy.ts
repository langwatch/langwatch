export type UsageUnit = "traces" | "events";

export interface MeterDecision {
  usageUnit: UsageUnit;
  reason: string;
}

/**
 * Resolves which counting unit to use for usage metering.
 *
 * Precedence:
 *   1. License override with explicit usageUnit → use that unit
 *   2. Seat-event billed (active GROWTH_SEAT_* subscription) → always events
 *   3. Free tier (isFree=true) → events regardless of billing
 *   4. Paid non-seat-event → traces
 *
 * `isSeatEvent` derives from the organization's active subscription plan
 * (ADR-039) — never from the Organization.pricingModel column, which is a
 * display cache that can drift.
 *
 * This is a pure decision function — no side effects, no I/O.
 */
export function resolveUsageMeter({
  isSeatEvent,
  licenseUsageUnit,
  hasValidLicenseOverride,
  isFree,
}: {
  isSeatEvent: boolean;
  licenseUsageUnit?: string;
  hasValidLicenseOverride: boolean;
  isFree: boolean;
}): MeterDecision {
  const usageUnit = resolveUsageUnit({
    isSeatEvent,
    licenseUsageUnit,
    hasValidLicenseOverride,
    isFree,
  });

  const reason = buildReason({
    usageUnit,
    hasValidLicenseOverride,
    licenseUsageUnit,
    isSeatEvent,
    isFree,
  });

  return { usageUnit, reason };
}

function resolveUsageUnit({
  isSeatEvent,
  licenseUsageUnit,
  hasValidLicenseOverride,
  isFree,
}: {
  isSeatEvent: boolean;
  licenseUsageUnit?: string;
  hasValidLicenseOverride: boolean;
  isFree: boolean;
}): UsageUnit {
  // License override with explicit usageUnit takes precedence
  if (hasValidLicenseOverride && licenseUsageUnit) {
    return normalizeUsageUnit(licenseUsageUnit);
  }

  // Subscription-derived: seat-event billing → events, else → traces
  if (isSeatEvent) {
    return "events";
  }

  // Free-tier always counts events regardless of billing
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
  hasValidLicenseOverride,
  licenseUsageUnit,
  isSeatEvent,
  isFree,
}: {
  usageUnit: UsageUnit;
  hasValidLicenseOverride: boolean;
  licenseUsageUnit?: string;
  isSeatEvent: boolean;
  isFree: boolean;
}): string {
  const unitSource =
    hasValidLicenseOverride && licenseUsageUnit
      ? `license(${licenseUsageUnit})`
      : isFree && !isSeatEvent
        ? "freeTier"
        : `subscription(seatEvent=${isSeatEvent})`;

  return `unit=${usageUnit} from ${unitSource}, isFree=${isFree}`;
}
