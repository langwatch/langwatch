import {
  LicenseOverageMaxRequiresOverageError,
  type LicenseTermsInput,
} from "@langwatch/enterprise-licensing-contract";
import { UNLIMITED } from "@langwatch/plans";

import type {
  IssuedLicenseDraft,
  IssuedLicenseRecord,
} from "../repositories/issued-license.repository.ts";

type StoredLiteSeats = Pick<IssuedLicenseRecord, "maxMembersLite" | "liteSeatsUnlimited">;

/** A signed license's lite seats as the row stores them: unlimited is a flag, never a number. */
export function storedLiteSeats({ signed }: { signed: number | undefined }): StoredLiteSeats {
  if (signed === UNLIMITED) return { maxMembersLite: null, liteSeatsUnlimited: true };
  return { maxMembersLite: signed ?? null, liteSeatsUnlimited: false };
}

/** A stored row's lite seats as a license signs them, the inverse of `storedLiteSeats`. */
export function signedLiteSeats(row: StoredLiteSeats): { membersLite: number | undefined } {
  if (row.liteSeatsUnlimited) return { membersLite: UNLIMITED };
  return { membersLite: row.maxMembersLite ?? undefined };
}

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
