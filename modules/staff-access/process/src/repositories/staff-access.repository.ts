/**
 * Staff access's owned state (ADR-193): enrolled agents, passkey challenges, requests and the
 * sessions they become, and the call trail. Every claim (`approve`, `redeem`, `claim...`) is one
 * conditional UPDATE, so of two racing callers exactly one wins.
 */
import type { Instant } from "@langwatch/time";

export type StaffAccessRequesterRow = Readonly<{
  id: string;
  ownerUserId: string;
  name: string;
  lookupId: string;
  hashedSecret: string;
  expiresAt: Instant;
  revokedAt: Instant | null;
  lastUsedAt: Instant | null;
  createdAt: Instant;
}>;

export type StaffAccessChallengeRow = Readonly<{
  id: string;
  userId: string;
  purpose: string;
  challenge: string;
  expiresAt: Instant;
  usedAt: Instant | null;
  createdAt: Instant;
}>;

export type StaffAccessRequestRow = Readonly<{
  id: string;
  requesterId: string;
  ownerUserId: string;
  scopes: string[];
  organizationId: string | null;
  organizationName: string | null;
  counterpartOrganizationId: string | null;
  counterpartOrganizationName: string | null;
  /** What a copy target may create, fixed when the request was made; empty otherwise. */
  copyGrant: string[];
  reason: string;
  codeChallenge: string;
  machine: string;
  requestIp: string | null;
  status: string;
  expiresAt: Instant;
  approvedAt: Instant | null;
  spendApproved: boolean;
  approvalCredentialId: string | null;
  approvalSignature: string | null;
  signedHash: string | null;
  redeemedAt: Instant | null;
  pinnedIp: string | null;
  apiKeyId: string | null;
  hashedOpsToken: string | null;
  opsTokenLookupId: string | null;
  accessExpiresAt: Instant | null;
  revokedAt: Instant | null;
  revokedByUserId: string | null;
  revokeCause: string | null;
  endAuditedAt: Instant | null;
  createdAt: Instant;
}>;

export type StaffAccessEventRow = Readonly<{
  id: string;
  requestId: string;
  at: Instant;
  method: string;
  path: string;
  operation: string;
  permissions: string[];
  organizationId: string | null;
  projectId: string | null;
  status: number | null;
  errorCode: string | null;
  durationMs: number | null;
  ipAddress: string | null;
  userAgent: string | null;
}>;

/** One object an organization copy made: which source object became which target object. */
export type StaffAccessCopyLedgerRow = Readonly<{
  id: string;
  requestId: string;
  sourceOrganizationId: string;
  targetOrganizationId: string;
  kind: string;
  sourceId: string;
  targetId: string;
  sourceProjectId: string;
  targetProjectId: string;
  createdAt: Instant;
}>;

export interface StaffAccessRequesterRepository {
  create(row: StaffAccessRequesterRow): Promise<void>;
  findByLookupId(input: { lookupId: string }): Promise<StaffAccessRequesterRow[]>;
  findById(input: { id: string }): Promise<StaffAccessRequesterRow[]>;
  findByOwner(input: { ownerUserId: string }): Promise<StaffAccessRequesterRow[]>;
  touch(input: { id: string; at: Instant }): Promise<void>;
  /** Revokes one of the owner's live requesters; false when there was none. */
  revoke(input: { id: string; ownerUserId: string; at: Instant }): Promise<boolean>;
}

export interface StaffAccessChallengeRepository {
  create(row: StaffAccessChallengeRow): Promise<void>;
  /** The person's unused, unexpired challenges for one purpose, newest first. */
  findOpen(input: {
    userId: string;
    purpose: string;
    at: Instant;
  }): Promise<StaffAccessChallengeRow[]>;
  /** Spends one challenge; false when it was already spent. */
  claim(input: { id: string; at: Instant }): Promise<boolean>;
}

export type StaffAccessApproval = Readonly<{
  id: string;
  at: Instant;
  spendApproved: boolean;
  credentialId: string;
  signature: string;
  signedHash: string;
}>;

export type StaffAccessRedemption = Readonly<{
  id: string;
  requesterId: string;
  at: Instant;
  pinnedIp: string | null;
  accessExpiresAt: Instant;
}>;

export interface StaffAccessRequestRepository {
  create(row: StaffAccessRequestRow): Promise<void>;
  countSince(input: { requesterId: string; since: Instant }): Promise<number>;
  findById(input: { id: string }): Promise<StaffAccessRequestRow[]>;
  findByApiKeyId(input: { apiKeyId: string }): Promise<StaffAccessRequestRow[]>;
  findByOpsTokenLookupId(input: { lookupId: string }): Promise<StaffAccessRequestRow[]>;
  /** Created since `since`, newest first, at most `limit`. */
  findRecent(input: { since: Instant; limit: number }): Promise<StaffAccessRequestRow[]>;
  /** Pending, approved or redeemed, not revoked, and not past its window. */
  findLive(input: { at: Instant }): Promise<StaffAccessRequestRow[]>;
  /** Redeemed, never revoked, past its hour, and not yet audited as ended. */
  findEndedUnaudited(input: { at: Instant; limit: number }): Promise<StaffAccessRequestRow[]>;
  /** pending -> approved while unexpired; false when another decision or the clock won. */
  approve(input: StaffAccessApproval): Promise<boolean>;
  /** pending -> denied; false when it was not pending. */
  deny(input: { id: string; at: Instant }): Promise<boolean>;
  /** approved -> redeemed once, by its own requester, while unexpired. */
  redeem(input: StaffAccessRedemption): Promise<boolean>;
  attachCredentials(input: {
    id: string;
    apiKeyId: string | null;
    hashedOpsToken: string | null;
    opsTokenLookupId: string | null;
  }): Promise<void>;
  /**
   * pending, approved or redeemed -> revoked, once; the revoke is its own end-of-session audit.
   * False once the hour ran out or the end was audited: the sweep records a natural end.
   */
  revoke(input: {
    id: string;
    at: Instant;
    byUserId: string | null;
    cause: string;
  }): Promise<boolean>;
  /** Marks a session's natural end audited, once; false when another sweep took it. */
  claimEndAudit(input: { id: string; at: Instant }): Promise<boolean>;
  releaseEndAudit(input: { id: string }): Promise<void>;
}

export interface StaffAccessEventRepository {
  create(row: StaffAccessEventRow): Promise<void>;
  finish(input: {
    id: string;
    status: number;
    errorCode: string | null;
    durationMs: number;
  }): Promise<void>;
  findByRequest(input: { requestId: string }): Promise<StaffAccessEventRow[]>;
}

export interface StaffAccessCopyLedgerRepository {
  /** Every object earlier copies made from the source organization into the target one. */
  findForPair(input: {
    sourceOrganizationId: string;
    targetOrganizationId: string;
  }): Promise<StaffAccessCopyLedgerRow[]>;
  /** Records one copied object; false when the target already holds a copy of that source. */
  record(row: StaffAccessCopyLedgerRow): Promise<boolean>;
}
