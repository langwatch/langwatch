// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { extractEmailDomain } from "@ee/sso/matching";
import {
  normalizeDomain,
  qualifySsoDomainOwnership,
  ssoDomainVerificationSchema,
} from "@langwatch/identity";

/**
 * Whether the replacement can match a person to their existing account by
 * address when they arrive through it.
 *
 * One answer for two callers: the link policy decides a real arrival with it,
 * and the update's progress predicts the same arrival before it happens. A
 * prediction written with a rule of its own would drift, and the update would
 * either wait for people the replacement already recognises or finish while
 * somebody it cannot recognise still depends on the previous provider.
 */
export type SsoArrivalMatch =
  | "matched"
  | "unverified-address"
  | "shared-address"
  | "unproved-domain";

export function arrivalMatchOf({
  email,
  vouchedFor,
  accountsHoldingAddress,
  provesDomain,
}: {
  email: string | null;
  /** Verified, or provisioned by a directory sync of the pair. */
  vouchedFor: boolean;
  /** Accounts holding this address, compared without case. */
  accountsHoldingAddress: number;
  provesDomain: (domain: string) => boolean;
}): SsoArrivalMatch {
  if (!email || !vouchedFor) return "unverified-address";
  if (accountsHoldingAddress !== 1) return "shared-address";
  const rawDomain = extractEmailDomain(email);
  if (!rawDomain) return "unproved-domain";
  return provesDomain(normalizeDomain(rawDomain))
    ? "matched"
    : "unproved-domain";
}

/**
 * Whether the replacement's own evidence proves this email domain.
 *
 * Verification rows that do not parse are dropped rather than trusted: a proof
 * we cannot read is not a proof, and reading it as one would qualify a domain
 * on the strength of a malformed row.
 */
export function replacementProvesDomain({
  replacement,
  domain,
}: {
  replacement: {
    id: string;
    organizationId: string;
    replacesConnectionId: string | null;
    verifiedDomains: string[];
    domainVerifications: unknown;
  };
  domain: string;
}): boolean {
  const parsed = ssoDomainVerificationSchema
    .array()
    .safeParse(replacement.domainVerifications);
  return (
    qualifySsoDomainOwnership({
      state: {
        connectionId: replacement.id,
        organizationId: replacement.organizationId,
        replacesConnectionId: replacement.replacesConnectionId,
        verifiedDomains: replacement.verifiedDomains,
        domainVerifications: parsed.success ? parsed.data : [],
      },
      domain,
    }).status === "QUALIFIED"
  );
}
