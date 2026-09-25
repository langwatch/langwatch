import type { LookupOperatorActivityRow } from "@langwatch/identity-contract";

/**
 * The cross-organization reads the operator lookup takes (D05 tier 1).
 * Reads only: these rows are projections of the log, so a write here
 * would be overwritten by the next fold (`sso-connection-backoffice`).
 */
export abstract class IdentityLookupRepository {
  abstract findIdentifiersByValue(input: {
    value: string;
  }): Promise<readonly LookupIdentifierRow[]>;

  abstract findIdentifiersForUser(input: {
    userId: string;
  }): Promise<readonly LookupIdentifierRow[]>;

  abstract findUsers(input: { userIds: readonly string[] }): Promise<readonly LookupUserRow[]>;

  abstract findMemberships(input: {
    userIds: readonly string[];
  }): Promise<readonly LookupMembershipRow[]>;

  abstract findInvitations(input: { email: string }): Promise<readonly LookupInvitationRow[]>;

  abstract findConnectionForDomain(input: { domain: string }): Promise<LookupConnectionRow | null>;

  /** The claims naming any of these domains, longest wait first. */
  abstract findClaimsAwaitingReview(input: {
    domains: readonly string[];
  }): Promise<readonly LookupDomainClaimRow[]>;

  /** Every claim waiting on a review, longest wait first. */
  abstract findClaimQueue(input: { limit: number }): Promise<readonly LookupDomainClaimRow[]>;

  abstract findOrganizationNames(input: {
    organizationIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;

  abstract findRecentOperatorActivity(input: {
    limit: number;
  }): Promise<readonly LookupOperatorActivityRow[]>;
}

export interface LookupIdentifierRow {
  identifierId: string;
  userId: string;
  provider: string;
  value: string | null;
  domain: string | null;
  state: string;
  connectionId: string | null;
  verifiedAtMs: number | null;
  attachedAtMs: number;
  detachedAtMs: number | null;
}

export interface LookupUserRow {
  userId: string;
  name: string | null;
  email: string | null;
}

export interface LookupMembershipRow {
  userId: string;
  organizationId: string;
  organizationName: string | null;
  role: string;
}

export interface LookupInvitationRow {
  inviteId: string;
  email: string;
  organizationId: string;
  organizationName: string | null;
  invitedByName: string | null;
  status: string;
  expiresAtMs: number | null;
}

export interface LookupConnectionRow {
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  state: string;
  providerId: string;
  ownershipProof: "QUALIFIED" | "UNKNOWN" | "LAPSED";
  routeKind: "legacy-configuration" | "connection";
}

export interface LookupDomainClaimRow {
  connectionId: string;
  organizationId: string;
  domain: string;
  /** When the connection last moved, which for a claimed one is the claim. */
  waitingSinceMs: number;
}
