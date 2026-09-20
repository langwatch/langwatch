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
    // unique index refuses the second. The constraint the table names is what
    // tells the two apart: a `replacesId` clash means this license was already
    // reissued, which is `reissue`'s own refusal, and every other clash means
    // the license itself is already registered.
    if (violationNames({ error, column: "replacesId" })) throw error;
    if (isUniqueViolation(error)) throw new LicenseAlreadyRegisteredError();
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

/**
 * Whether a unique violation is the one on this column. Prisma reports it in
 * `meta.target`, sometimes as the column and sometimes as the index built over
 * it, so the column name is looked for inside each entry rather than compared.
 * A client that names nothing answers false, which leaves the caller with the
 * refusal that fits every constraint on this table but one.
 */
export function violationNames({
  error,
  column,
}: {
  error: unknown;
  column: string;
}): boolean {
  if (!isUniqueViolation(error)) return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const names = Array.isArray(target)
    ? target
    : typeof target === "string"
      ? [target]
      : [];
  return names.some(
    (name) => typeof name === "string" && name.includes(column),
  );
}

/** Prisma's unique constraint violation, without importing Prisma here. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
