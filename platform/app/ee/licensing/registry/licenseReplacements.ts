/**
 * Signing a replacement for a license that is already issued, which is what
 * both a renewal (`reissue`) and a mid-term seat change stand on.
 *
 * The replaced license stays valid until the install presents the new one,
 * because it is what authenticates the sync that delivers it, and the new
 * license inherits the instance binding so a reissued license that leaks
 * cannot be bound by another install first.
 */

import { generateLicenseKey } from "../licenseGenerationService";
import {
  LicenseAlreadyRegisteredError,
  LicenseAlreadyReissuedError,
} from "./errors";
import type { IssuedLicenseRecord } from "./issuedLicense";
import { isUniqueViolation } from "./issuedLicenseRows";

/** What a caller decides about the replacement: the term and the seats. */
export type LicenseReplacementTerms = {
  current: IssuedLicenseRecord;
  maxMembers?: number;
  maxMembersLite?: number;
  maxMessagesPerMonth?: number;
  expiresAt: Date;
  operatorId: string;
};

export async function signReplacementLicense(
  input: LicenseReplacementTerms & {
    privateKey: string;
    now: Date;
    encrypt: (value: string) => string;
    createRow: (params: {
      licenseKey: string;
      organizationId: string | null;
      source: "BACKOFFICE";
      issuedById: string | null;
      overrides?: Partial<IssuedLicenseRecord>;
    }) => Promise<IssuedLicenseRecord>;
  },
): Promise<{ licenseKey: string; row: IssuedLicenseRecord }> {
  const { current } = input;

  const { licenseKey } = generateLicenseKey({
    organizationName: current.organizationName,
    email: current.email,
    planType: current.planType,
    maxMembers: input.maxMembers ?? current.maxMembers,
    maxMembersLite: input.maxMembersLite ?? current.maxMembersLite,
    maxMessagesPerMonth: input.maxMessagesPerMonth,
    expiresAt: input.expiresAt,
    connectServices: current.services,
    privateKey: input.privateKey,
    now: input.now,
  });

  let row: IssuedLicenseRecord;
  try {
    row = await input.createRow({
      licenseKey,
      organizationId: current.organizationId,
      source: "BACKOFFICE",
      issuedById: input.operatorId,
      overrides: {
        replacesId: current.id,
        pendingDeliveryLicense: input.encrypt(licenseKey),
        services: current.services,
        seatRateCents: current.seatRateCents,
        seatCurrency: current.seatCurrency,
        commitUsdCents: current.commitUsdCents,
        overageEnabled: current.overageEnabled,
        overageMaxUsdCents: current.overageMaxUsdCents,
        instanceId: current.instanceId,
        instanceBoundAt: current.instanceBoundAt,
      },
    });
  } catch (error) {
    // A tokenHash or licenseId clash is already named by the row writer. Only
    // a replacesId clash reaches here, and it means the license this one
    // replaces was reissued by somebody else first.
    if (error instanceof LicenseAlreadyRegisteredError) throw error;
    if (isUniqueViolation(error)) throw new LicenseAlreadyReissuedError();
    throw error;
  }
  return { licenseKey, row };
}
