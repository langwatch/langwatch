/**
 * What a customer's licenses add up to commercially (ADR-156). The budget spans licenses, so the
 * terms do too: the commit is the sum of the commits, and the most a customer may raise its own cap
 * to is that sum plus every overage maximum that is switched on.
 */

import {
  entitledConnectServices,
  type ContractTerms,
} from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";

import type { IssuedLicenseRecord } from "../repositories/issued-license.repository.ts";
import { statusOfIssuedLicense } from "./issued-license.rules.ts";

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
  now: Instant;
}): ContractTerms {
  const replaced = new Set(
    licenses
      .filter((license) => license.replacesId && !license.revokedAt)
      .map((license) => license.replacesId),
  );
  const counted = licenses.filter(
    (license) => statusOfIssuedLicense(license, now) === "active" && !replaced.has(license.id),
  );

  const commitUsdCents = sum(counted.map((license) => license.commitUsdCents));
  const overageUsdCents = sum(
    counted.map((license) => (license.overageEnabled ? (license.overageMaxUsdCents ?? 0) : 0)),
  );

  return {
    commitUsdCents,
    maximumUsdCents: commitUsdCents + overageUsdCents,
    overageEnabled: counted.some((license) => license.overageEnabled),
    services: entitledConnectServices([...new Set(counted.flatMap((license) => license.services))]),
    termEndsAt: pickLatest(counted.map((license) => license.expiresAt)),
    termStartsAt: pickEarliest(counted.map((license) => license.issuedAt)),
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function pickLatest(instants: Instant[]): string | null {
  return instants.length === 0
    ? null
    : instants.reduce((a, b) => (Temporal.Instant.compare(a, b) >= 0 ? a : b)).toString();
}

function pickEarliest(instants: Instant[]): string | null {
  return instants.length === 0
    ? null
    : instants.reduce((a, b) => (Temporal.Instant.compare(a, b) <= 0 ? a : b)).toString();
}
