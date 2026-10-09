import { Temporal, type Instant } from "@langwatch/time";

import type { LicenseColumns } from "../repositories/organization-license.repository.ts";

const sameInstant = (a: Instant | null, b: Instant | null) =>
  a === null || b === null ? a === b : a.equals(b);

/** Whether two licences hold the same key and the same dates. */
export function sameLicense({ a, b }: Readonly<{ a: LicenseColumns; b: LicenseColumns }>): boolean {
  return (
    a.licenseKey === b.licenseKey &&
    sameInstant(a.expiresAt, b.expiresAt) &&
    sameInstant(a.validatedAt, b.validatedAt)
  );
}

/**
 * Whether organization's columns win over licensing's row while dual writes last: only when
 * there is no row, or organization's row was written after it (Alex, 2026-10-09).
 */
export function isOrganizationNewer({
  organizationUpdatedAt,
  licenseUpdatedAt,
}: Readonly<{ organizationUpdatedAt: Instant; licenseUpdatedAt: Instant | null }>): boolean {
  return (
    licenseUpdatedAt === null ||
    Temporal.Instant.compare(organizationUpdatedAt, licenseUpdatedAt) > 0
  );
}
