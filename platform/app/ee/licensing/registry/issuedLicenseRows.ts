/**
 * Writing a registry row: what the signed license itself dictates, and the
 * duplicate rules the table enforces (ADR-139).
 */

import { LicenseKeyInvalidError } from "../errors";
import { licenseTokenFromKey, registryHashForToken } from "../licenseToken";
import type { SignedLicense } from "../types";
import { parseLicenseKey } from "../validation";
import { LicenseAlreadyRegisteredError } from "./errors";
import type {
  IssuedLicenseRecord,
  IssuedLicenseRepository,
  IssuedLicenseSource,
} from "./issuedLicense";

export async function createIssuedLicenseRow({
  repository,
  licenseKey,
  organizationId,
  source,
  issuedById,
  overrides = {},
}: {
  repository: IssuedLicenseRepository;
  licenseKey: string;
  organizationId: string | null;
  source: IssuedLicenseSource;
  issuedById: string | null;
  overrides?: Partial<IssuedLicenseRecord>;
}): Promise<IssuedLicenseRecord> {
  const signed = parseLicenseKey(licenseKey.trim());
  const token = licenseTokenFromKey(licenseKey);
  if (!signed || !token) throw new LicenseKeyInvalidError();

  const tokenHash = registryHashForToken(token);
  // The read is what gives the operator the named refusal; the catch below
  // is what covers the write that raced it, because the table decides.
  if (await repository.findByTokenHash(tokenHash)) {
    throw new LicenseAlreadyRegisteredError();
  }
  try {
    return await repository.create({
      ...rowFromSignedLicense(signed),
      tokenHash,
      organizationId,
      source,
      issuedById,
      revokedAt: null,
      revokedById: null,
      revokedReason: null,
      supersededAt: null,
      replacesId: null,
      pendingDeliveryLicense: null,
      services: [],
      seatOverageAllowance: null,
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
      ...overrides,
    });
  } catch (error) {
    // Two writes of the same license key both pass the read above, and the
    // unique index refuses the second. A replacement row can also collide on
    // `replacesId`, which means the license was already reissued: that one
    // belongs to `reissue` and keeps its own refusal.
    const isReplacement = overrides.replacesId != null;
    if (isUniqueViolation(error) && !isReplacement) {
      throw new LicenseAlreadyRegisteredError();
    }
    throw error;
  }
}

/** What the signed license itself says, which is the source for these columns. */
function rowFromSignedLicense(
  signed: SignedLicense,
): Pick<
  IssuedLicenseRecord,
  | "licenseId"
  | "organizationName"
  | "email"
  | "planType"
  | "maxMembers"
  | "maxMembersLite"
  | "issuedAt"
  | "expiresAt"
> {
  return {
    licenseId: signed.data.licenseId,
    organizationName: signed.data.organizationName,
    email: signed.data.email,
    planType: signed.data.plan.type,
    maxMembers: signed.data.plan.maxMembers,
    maxMembersLite: signed.data.plan.maxMembersLite ?? 0,
    issuedAt: new Date(signed.data.issuedAt),
    expiresAt: new Date(signed.data.expiresAt),
  };
}

/** Prisma's unique constraint violation, without importing Prisma here. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
