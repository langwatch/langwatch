/**
 * What an activation code row is, and how the registry reaches it (ADR-141,
 * section 5).
 */

export interface ActivationCodeRecord {
  id: string;
  codeHint: string;
  organizationId: string;
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  maxMembersLite: number;
  licenseTermDays: number;
  services: string[];
  expiresAt: Date;
  reusable: boolean;
  redeemedAt: Date | null;
  redeemedByInstanceId: string | null;
  issuedLicenseId: string | null;
  redemptionCount: number;
  revokedAt: Date | null;
  createdAt: Date;
}

/** A code as the backoffice reads it, with the verdict already worked out. */
export interface ActivationCodeView extends ActivationCodeRecord {
  status: ActivationCodeStatus;
}

export type ActivationCodeStatus =
  | "active"
  | "redeemed"
  | "expired"
  | "revoked";

export function statusOfActivationCode(
  row: ActivationCodeRecord,
  now: Date,
): ActivationCodeStatus {
  if (row.revokedAt) return "revoked";
  if (!row.reusable && row.redeemedAt) return "redeemed";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export interface ActivationCodeRepository {
  create(input: {
    codeHash: string;
    codeHint: string;
    organizationId: string;
    organizationName: string;
    email: string;
    planType: string;
    maxMembers: number;
    maxMembersLite: number;
    licenseTermDays: number;
    services: string[];
    expiresAt: Date;
    reusable: boolean;
    createdById: string;
  }): Promise<ActivationCodeRecord>;

  findByCodeHash(codeHash: string): Promise<ActivationCodeRecord | null>;
  findById(id: string): Promise<ActivationCodeRecord | null>;

  findAll(input: {
    page: number;
    pageSize: number;
    organizationId?: string;
  }): Promise<{ rows: ActivationCodeRecord[]; total: number }>;

  /**
   * Claims a single-use code for one install, as one conditional write.
   *
   * The state the caller read is part of the write, so a revocation, an expiry
   * or another install's redemption landing between the read and this statement
   * takes the claim with it. Answers true only to the caller that won.
   */
  claimSingleUse(input: {
    id: string;
    instanceId: string;
    at: Date;
  }): Promise<boolean>;

  /** Records one redemption of a reusable code. */
  recordReusableRedemption(input: {
    id: string;
    instanceId: string;
    at: Date;
  }): Promise<boolean>;

  /** Names the license a winning single-use claim minted. */
  attachIssuedLicense(input: {
    id: string;
    issuedLicenseId: string;
  }): Promise<void>;

  /**
   * Puts a claim back when signing the license failed after it was made.
   *
   * Conditional on the claim still being this install's, so a reusable code
   * another install has since redeemed keeps that redemption.
   */
  releaseClaim(input: { id: string; instanceId: string }): Promise<void>;

  revoke(input: {
    id: string;
    at: Date;
    revokedById: string;
  }): Promise<ActivationCodeRecord | null>;
}
