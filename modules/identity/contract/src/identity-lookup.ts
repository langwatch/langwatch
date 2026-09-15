import type { SignInRoutingOutcome, SignInRoutingReasonCode } from "./signin-routing.ts";

/** D05 tier 1: one address, five operator panels (ADR-117 §1, §3). */
export const IDENTITY_LOOKUP_HISTORY_LIMIT = 50;
export const OPERATOR_ACTIVITY_LIMIT = 50;

/** The prefix every act on this surface is recorded under. */
export const IDENTITY_LOOKUP_AUDIT_PREFIX = "identityLookup.";

export interface IdentityLookupAnswer {
  /** What the operator typed, kept verbatim. */
  typed: string;
  /** What the auth screens' own normalization makes of it. */
  resolved: string;
  domain: string | null;
  routing: LookupRouting;
  people: readonly LookupPerson[];
}

export interface LookupRouting {
  outcome: SignInRoutingOutcome;
  reasonCode: SignInRoutingReasonCode;
  connectionId: string | null;
  methods: readonly string[];
  connection: LookupConnection | null;
}

/** The domain-owning connection, named beside the routing decision. */
export interface LookupConnection {
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  state: string;
  providerId: string;
}

export interface LookupPerson {
  userId: string;
  name: string | null;
  email: string | null;
  organizations: readonly LookupOrganizationMembership[];
  /** How this person holds the address that was looked up. */
  holding: readonly LookupIdentifier[];
}

export interface LookupOrganizationMembership {
  organizationId: string;
  name: string | null;
  role: string;
}

export interface LookupIdentifier {
  identifierId: string;
  provider: string;
  value: string | null;
  domain: string | null;
  state: string;
  connectionId: string | null;
  verifiedAtMs: number | null;
  attachedAtMs: number;
  detachedAtMs: number | null;
}

export interface LookupPersonDetail {
  person: LookupPerson;
  identifiers: readonly LookupIdentifier[];
  waiting: LookupWaiting;
}

/**
 * Invitations only for now: `LINK_PROPOSED` folds to no head (a person-stream
 * fact with no Postgres projection), so sign-ins awaiting confirmation have
 * no read path yet. See the identity-lookup-server-reads handoff.
 */
export interface LookupWaiting {
  invitations: readonly LookupInvitation[];
  isEmpty: boolean;
}

export interface LookupInvitation {
  inviteId: string;
  email: string;
  organizationId: string;
  organizationName: string | null;
  invitedByName: string | null;
  status: string;
  expiresAtMs: number | null;
  isExpired: boolean;
}

/** One operator act, read off the same trail every repair writes to. */
export interface LookupOperatorActivityRow {
  auditId: string;
  operatorUserId: string | null;
  operatorName: string | null;
  act: string;
  address: string | null;
  atMs: number;
}
