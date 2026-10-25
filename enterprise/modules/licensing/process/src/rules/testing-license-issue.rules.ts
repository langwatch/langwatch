/**
 * What Cloud signs into a testing licence (ADR-180 section 2): Enterprise features, 10 full and
 * 10 Lite seats, no hosted services, commit or overage, for as long as asked up to 30 days.
 */

import { TESTING_LICENSE_SEATS } from "@langwatch/plans";
import type { Instant } from "@langwatch/time";

/** The fixed terms of every testing licence; the instance and organization come from the ask. */
export const TESTING_LICENSE_TERMS = {
  planType: "ENTERPRISE",
  ...TESTING_LICENSE_SEATS,
  organizationName: "LangWatch testing license",
  email: "testing-licenses@langwatch.ai",
} as const;

export const TESTING_LICENSE_DEFAULT_LIFETIME_HOURS = 5 * 24;
export const TESTING_LICENSE_MAX_LIFETIME_DAYS = 30;

export type TestingLicenseExpiry =
  | { readonly allowed: true; readonly expiresAt: Instant }
  | { readonly allowed: false; readonly maxDays: number };

/** The expiry of a testing licence asked for now; a lifetime past the limit is not allowed. */
export function testingLicenseExpiry({
  now,
  lifetimeHours,
}: {
  now: Instant;
  lifetimeHours: number | undefined;
}): TestingLicenseExpiry {
  const hours = lifetimeHours ?? TESTING_LICENSE_DEFAULT_LIFETIME_HOURS;
  if (hours > TESTING_LICENSE_MAX_LIFETIME_DAYS * 24) {
    return { allowed: false, maxDays: TESTING_LICENSE_MAX_LIFETIME_DAYS };
  }
  return { allowed: true, expiresAt: now.add({ hours }) };
}
