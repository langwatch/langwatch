/**
 * What a customer's licenses add up to commercially (ADR-141).
 *
 * The budget spans licenses, so the terms do too: the commit is the sum of the
 * commits, and the most a customer may raise its own cap to is that sum plus
 * every overage maximum that is switched on.
 */

import {
  type IssuedLicenseRecord,
  statusOfIssuedLicense,
} from "../registry/issuedLicense";

export interface ContractTerms {
  /** Prepaid usage across the customer's licenses. The default cap. */
  commitUsdCents: number;
  /** The highest cap the customer may set: the commit plus agreed overage. */
  maximumUsdCents: number;
  overageEnabled: boolean;
  /** Hosted services any of the licenses is entitled to. */
  services: string[];
  /** When the last of the counted terms ends, or null when none counts. */
  termEndsAt: Date | null;
  /** When the first of the counted terms began, or null when none counts. */
  termStartsAt: Date | null;
}

/**
 * A license counts while it is active and has not been reissued. A reissued
 * license stays valid until its replacement is delivered, and counting both
 * would double the commit for that window.
 */
export function contractTermsOf({
  licenses,
  now,
}: {
  licenses: readonly IssuedLicenseRecord[];
  now: Date;
}): ContractTerms {
  const replaced = new Set(
    licenses
      .filter((license) => license.replacesId && !license.revokedAt)
      .map((license) => license.replacesId),
  );
  const counted = licenses.filter(
    (license) =>
      statusOfIssuedLicense(license, now) === "active" &&
      !replaced.has(license.id),
  );

  const commitUsdCents = sum(counted.map((license) => license.commitUsdCents));
  const overageUsdCents = sum(
    counted.map((license) =>
      license.overageEnabled ? (license.overageMaxUsdCents ?? 0) : 0,
    ),
  );
  const ends = counted.map((license) => license.expiresAt.getTime());
  const starts = counted.map((license) => license.issuedAt.getTime());
  return {
    commitUsdCents,
    maximumUsdCents: commitUsdCents + overageUsdCents,
    overageEnabled: counted.some((license) => license.overageEnabled),
    services: [...new Set(counted.flatMap((license) => license.services))],
    termEndsAt: ends.length > 0 ? new Date(Math.max(...ends)) : null,
    termStartsAt: starts.length > 0 ? new Date(Math.min(...starts)) : null,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
