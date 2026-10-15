import {
  LicenseOverageMaxRequiresOverageError,
  type LicenseData,
  type LicenseTermsInput,
} from "@langwatch/enterprise-licensing-contract";
import { Temporal } from "@langwatch/time";

import type {
  IssuedLicenseDraft,
  IssuedLicenseRecord,
} from "../repositories/issued-license.repository.ts";

/** What the replacement inherits from the license it replaces. */
export function replacementColumns({
  current,
  held,
}: {
  current: IssuedLicenseRecord;
  held: string;
}): Partial<IssuedLicenseRecord> {
  return {
    replacesId: current.id,
    pendingDeliveryLicense: held,
    services: current.services,
    seatRateCents: current.seatRateCents,
    seatCurrency: current.seatCurrency,
    commitUsdCents: current.commitUsdCents,
    overageEnabled: current.overageEnabled,
    overageMaxUsdCents: current.overageMaxUsdCents,
    instanceId: current.instanceId,
    instanceBoundAt: current.instanceBoundAt,
  };
}

/**
 * The columns a signed licence fixes on its own row. A testing licence is bound to its
 * instance from issue, never by whichever install presents it first (ADR-180 section 3).
 */
export function signedLicenseColumns({
  license,
}: {
  license: Pick<LicenseData, "kind" | "instanceId" | "organizationId" | "issuedAt">;
}): Partial<IssuedLicenseRecord> {
  if (license.kind !== "testing") return { kind: "standard", testingOrganizationId: null };
  return {
    kind: "testing",
    testingOrganizationId: license.organizationId ?? null,
    instanceId: license.instanceId ?? null,
    instanceBoundAt: Temporal.Instant.from(license.issuedAt),
  };
}

/** Every column a new row starts at, before the license and the caller speak. */
export function blankIssuedLicenseRow(): Omit<
  IssuedLicenseDraft,
  | "licenseId"
  | "tokenHash"
  | "organizationId"
  | "organizationName"
  | "email"
  | "planType"
  | "maxMembers"
  | "maxMembersLite"
  | "liteSeatsUnlimited"
  | "issuedAt"
  | "expiresAt"
  | "source"
  | "issuedById"
> {
  return {
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    pendingDeliveryLicense: null,
    services: [],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 0,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: null,
    instanceBoundAt: null,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    virtualKeyId: null,
    seatsRaisedFrom: null,
    kind: "standard",
    testingOrganizationId: null,
  };
}

/**
 * An overage maximum is only valid while overage is enabled, and switching
 * overage off clears it. Judged as the terms will stand, not as they arrived.
 */
export function resolveLicenseTerms({
  current,
  input,
}: {
  current: IssuedLicenseRecord | null;
  input: LicenseTermsInput | undefined;
}): LicenseTermsInput {
  if (!input) return {};
  const overageEnabled = input.overageEnabled ?? current?.overageEnabled ?? false;
  if (!overageEnabled && input.overageMaxUsdCents != null) {
    throw new LicenseOverageMaxRequiresOverageError();
  }
  if (!overageEnabled && input.overageEnabled === false) {
    return { ...input, overageMaxUsdCents: null };
  }
  return input;
}
