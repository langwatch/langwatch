/**
 * When a testing licence is honoured (ADR-180 sections 3 and 4): unexpired, on the
 * instance it was approved for, for the organization it names. A standard licence
 * is not judged here, so its policy stays exactly what it was.
 */

import {
  LICENSE_ERRORS,
  type LicenseData,
  type LicenseError,
} from "@langwatch/enterprise-licensing-contract";
import { toEpochMs, type Instant } from "@langwatch/time";

export type TestingLicenseVerdict =
  | { readonly honoured: true }
  | { readonly honoured: false; readonly error: LicenseError };

/** The longest a process may keep a testing licence's answer before reading it again. */
export const TESTING_LICENSE_CACHE_MS = 60_000;

export function isTestingLicense(license: Pick<LicenseData, "kind">): boolean {
  return license.kind === "testing";
}

/**
 * The instance and organization being resolved; an unknown one matches no testing licence.
 * An instance id named by configuration proves nothing, so it refuses every testing licence.
 */
export function testingLicenseVerdict({
  license,
  instanceId,
  instanceIdOverridden,
  organizationId,
  now,
}: {
  license: Pick<LicenseData, "kind" | "instanceId" | "organizationId" | "expiresAt">;
  instanceId: string | undefined;
  instanceIdOverridden: boolean;
  organizationId: string | undefined;
  now: Instant;
}): TestingLicenseVerdict {
  if (!isTestingLicense(license)) return { honoured: true };
  if (now.epochMilliseconds >= testingLicenseExpiryMs(license)) {
    return { honoured: false, error: LICENSE_ERRORS.EXPIRED };
  }
  if (instanceIdOverridden) {
    return { honoured: false, error: LICENSE_ERRORS.TESTING_INSTANCE_OVERRIDE };
  }
  if (instanceId === undefined || license.instanceId !== instanceId) {
    return { honoured: false, error: LICENSE_ERRORS.TESTING_WRONG_INSTANCE };
  }
  if (organizationId === undefined || license.organizationId !== organizationId) {
    return { honoured: false, error: LICENSE_ERRORS.TESTING_WRONG_ORGANIZATION };
  }
  return { honoured: true };
}

/** Epoch milliseconds a cached testing-licence answer lasts: its expiry, at most a minute. */
export function testingLicenseCacheUntilMs({
  license,
  now,
}: {
  license: Pick<LicenseData, "expiresAt">;
  now: Instant;
}): number {
  return Math.min(
    testingLicenseExpiryMs(license),
    now.epochMilliseconds + TESTING_LICENSE_CACHE_MS,
  );
}

/** An unreadable expiry counts as already passed. */
function testingLicenseExpiryMs(license: Pick<LicenseData, "expiresAt">): number {
  const expiresAtMs = toEpochMs(license.expiresAt);
  return Number.isNaN(expiresAtMs) ? Number.NEGATIVE_INFINITY : expiresAtMs;
}
