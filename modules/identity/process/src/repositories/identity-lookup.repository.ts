import type { LookupOperatorActivityRow } from "@langwatch/identity-contract";

/**
 * The cross-organization reads the operator lookup takes (D05 tier 1).
 * Reads only: these rows are projections of the log, so a write here
 * would be overwritten by the next fold (`sso-connection-backoffice`).
 */
export abstract class IdentityLookupRepository {
  abstract findIdentifiersByValue(input: { value: string }): Promise<readonly LookupIdentifierRow[]>;

  abstract findIdentifiersForUser(input: {
    userId: string;
  }): Promise<readonly LookupIdentifierRow[]>;

  abstract findUsers(input: { userIds: readonly string[] }): Promise<readonly LookupUserRow[]>;

  abstract findMemberships(input: {
    userIds: readonly string[];
  }): Promise<readonly LookupMembershipRow[]>;

  abstract findInvitations(input: { email: string }): Promise<readonly LookupInvitationRow[]>;

  abstract findConnectionForDomain(input: { domain: string }): Promise<LookupConnectionRow | null>;

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
}
