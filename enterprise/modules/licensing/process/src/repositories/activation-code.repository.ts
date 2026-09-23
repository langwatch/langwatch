/**
 * What an activation code row is, and how the registry reaches it (ADR-156,
 * section 5). The stored row stays on `Instant`; what leaves the feature is the
 * view.
 */

import type { Instant } from "@langwatch/time";

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
  expiresAt: Instant;
  reusable: boolean;
  redeemedAt: Instant | null;
  redeemedByInstanceId: string | null;
  issuedLicenseId: string | null;
  redemptionCount: number;
  revokedAt: Instant | null;
  createdAt: Instant;
}

export type ActivationCodeDraft = Readonly<{
  codeHash: string;
  codeHint: string;
  organizationId: string;
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  /** Undefined is the column's own default of none. */
  maxMembersLite: number | undefined;
  licenseTermDays: number;
  services: string[];
  expiresAt: Instant;
  reusable: boolean;
  createdById: string;
}>;

/** One install's attempt to take a code, as both conditional writes take it. */
export type ActivationClaim = Readonly<{ id: string; instanceId: string; at: Instant }>;

export interface ActivationCodeRepository {
  create(input: ActivationCodeDraft): Promise<ActivationCodeRecord>;

  findByCodeHash(codeHash: string): Promise<ActivationCodeRecord | null>;
  findById(id: string): Promise<ActivationCodeRecord | null>;

  findAll(input: {
    page: number;
    pageSize: number;
    organizationId?: string;
  }): Promise<{ rows: ActivationCodeRecord[]; total: number }>;

  /** One conditional write carrying the state the caller read, so anything
   *  landing in between takes the claim: true only to the caller that won. */
  claimSingleUse(input: ActivationClaim): Promise<boolean>;

  /** Records one redemption of a reusable code. */
  recordReusableRedemption(input: ActivationClaim): Promise<boolean>;

  /** Names the license a winning single-use claim minted. */
  attachIssuedLicense(input: { id: string; issuedLicenseId: string }): Promise<void>;

  /** Puts a claim back when signing failed, only while it is still this
   *  install's: a reusable code another install redeemed keeps that. */
  releaseClaim(input: { id: string; instanceId: string }): Promise<void>;

  /** Answers true only to the call that revoked it; revoking twice is false. */
  revoke(input: { id: string; at: Instant; revokedById: string }): Promise<boolean>;
}
