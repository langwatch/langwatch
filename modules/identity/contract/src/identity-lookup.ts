import { moduleApi } from "@langwatch/kernel/module-api";
import { z } from "zod";

import { IDENTITY_EVENT_TYPES, linkProposalReasonSchema } from "./facts.ts";
import { identifierProviderSchema, identityActorSchema } from "./vocabulary.ts";

/** D05 tier 1: one address, five operator panels (ADR-117 §1, §3). */
export const IDENTITY_LOOKUP_HISTORY_LIMIT = 50;
export const OPERATOR_ACTIVITY_LIMIT = 50;
export const DOMAIN_CLAIM_QUEUE_LIMIT = 50;

/** The prefix every act on this surface is recorded under. */
export const IDENTITY_LOOKUP_AUDIT_PREFIX = "identityLookup.";

/** The address as a support case arrives holding it. */
export const identityLookupAddressSchema = z.string().min(1).max(254);

export const lookupIdentifierSchema = z.object({
  identifierId: z.string(),
  provider: z.string(),
  value: z.string().nullable(),
  domain: z.string().nullable(),
  state: z.string(),
  connectionId: z.string().nullable(),
  verifiedAtMs: z.number().nullable(),
  attachedAtMs: z.number(),
  detachedAtMs: z.number().nullable(),
});
export type LookupIdentifier = z.infer<typeof lookupIdentifierSchema>;

export const lookupPersonSchema = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  organizations: z.array(
    z.object({ organizationId: z.string(), name: z.string().nullable(), role: z.string() }),
  ),
  /** How this person holds the address that was looked up. */
  holding: z.array(lookupIdentifierSchema),
});
export type LookupPerson = z.infer<typeof lookupPersonSchema>;

/** The domain-owning connection, named beside the routing decision. */
export const lookupConnectionSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  organizationName: z.string().nullable(),
  state: z.string(),
  providerId: z.string(),
  ownershipProof: z.enum(["QUALIFIED", "UNKNOWN", "LAPSED"]),
  routeKind: z.enum(["legacy-configuration", "connection"]),
});
export type LookupConnection = z.infer<typeof lookupConnectionSchema>;

export const lookupRoutingSchema = z.object({
  outcome: z.string(),
  reasonCode: z.string(),
  connectionId: z.string().nullable(),
  methods: z.array(z.string()),
  connection: lookupConnectionSchema.nullable(),
});
export type LookupRouting = z.infer<typeof lookupRoutingSchema>;

export const identityLookupAnswerSchema = z.object({
  /** What the operator typed, kept verbatim. */
  typed: z.string(),
  /** What the auth screens' own normalization makes of it. */
  resolved: z.string(),
  domain: z.string().nullable(),
  routing: lookupRoutingSchema,
  people: z.array(lookupPersonSchema),
  /** Whether this operator may repair, not only look. */
  canRepair: z.boolean(),
});
export type IdentityLookupAnswer = z.infer<typeof identityLookupAnswerSchema>;

export const lookupInvitationSchema = z.object({
  inviteId: z.string(),
  email: z.string(),
  organizationId: z.string(),
  organizationName: z.string().nullable(),
  invitedByName: z.string().nullable(),
  status: z.string(),
  expiresAtMs: z.number().nullable(),
  isExpired: z.boolean(),
});
export type LookupInvitation = z.infer<typeof lookupInvitationSchema>;

export const lookupDomainClaimSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  organizationName: z.string().nullable(),
  domain: z.string(),
  waitingSinceMs: z.number(),
});
export type LookupDomainClaim = z.infer<typeof lookupDomainClaimSchema>;

/** A proposal folded out of its facts; `decision` is null until one is stated. */
export const linkProposalRecordSchema = z.object({
  proposalId: z.string(),
  userId: z.string(),
  connectionId: z.string().nullable(),
  provider: identifierProviderSchema,
  providerAccountId: z.string(),
  value: z.string().nullable(),
  domain: z.string().nullable(),
  reason: linkProposalReasonSchema,
  proposedAtMs: z.number(),
  decision: z
    .object({
      outcome: z.enum(["confirmed", "rejected"]),
      byActorId: z.string().nullable(),
      atMs: z.number(),
    })
    .nullable(),
});
export type LinkProposalRecord = z.infer<typeof linkProposalRecordSchema>;

export const lookupWaitingSchema = z.object({
  proposals: z.array(linkProposalRecordSchema),
  invitations: z.array(lookupInvitationSchema),
  domainClaims: z.array(lookupDomainClaimSchema),
  isEmpty: z.boolean(),
});
export type LookupWaiting = z.infer<typeof lookupWaitingSchema>;

/** One identity fact as an operator reads it: ids, enums, times, never a secret. */
export const identityHistoryEntrySchema = z.object({
  eventId: z.string(),
  type: z.enum(IDENTITY_EVENT_TYPES),
  occurredAtMs: z.number(),
  actor: identityActorSchema,
  identifierId: z.string().nullable(),
  provider: z.string().nullable(),
  value: z.string().nullable(),
  domain: z.string().nullable(),
  connectionId: z.string().nullable(),
  proposalId: z.string().nullable(),
  detail: z.string().nullable(),
});
export type IdentityHistoryEntry = z.infer<typeof identityHistoryEntrySchema>;

export const lookupSessionSchema = z.object({
  sessionId: z.string(),
  identifierId: z.string().nullable(),
  createdAtMs: z.number(),
  expiresAtMs: z.number(),
});
export type LookupSession = z.infer<typeof lookupSessionSchema>;

export const lookupPersonDetailSchema = z.object({
  person: lookupPersonSchema,
  identifiers: z.array(lookupIdentifierSchema),
  waiting: lookupWaitingSchema,
  history: z.array(identityHistoryEntrySchema),
  sessions: z.array(lookupSessionSchema),
});
export type LookupPersonDetail = z.infer<typeof lookupPersonDetailSchema>;

/** One operator act, read off the same trail every repair writes to. */
export const lookupOperatorActivityRowSchema = z.object({
  auditId: z.string(),
  operatorUserId: z.string().nullable(),
  operatorName: z.string().nullable(),
  act: z.string(),
  address: z.string().nullable(),
  atMs: z.number(),
});
export type LookupOperatorActivityRow = z.infer<typeof lookupOperatorActivityRowSchema>;

export const lookupInvitationExpirySchema = z.object({ expiresAtMs: z.number().nullable() });
export type LookupInvitationExpiry = z.infer<typeof lookupInvitationExpirySchema>;

/** Whoever asked: the impersonator when there is one. */
export type IdentityLookupOperator = Readonly<{ userId: string }>;

/**
 * The platform operator's identity lookup (D05). Every operation records the
 * act before it gates, and refuses a non-operator with the generic `not_found`.
 */
/** A domain a person proved through a verified or primary identifier. */
export interface VerifiedUserDomain {
  userId: string;
  domain: string;
}

export interface IdentityLookupApi {
  /** Every domain these people proved, one row per person and domain. An address nobody
   *  confirmed is not evidence of who somebody works for. */
  findVerifiedDomainsByUserIds(input: {
    userIds: readonly string[];
  }): Promise<VerifiedUserDomain[]>;
  lookupAddress(input: {
    address: string;
    operator: IdentityLookupOperator;
  }): Promise<IdentityLookupAnswer>;
  getLookupPerson(input: {
    userId: string;
    address: string;
    operator: IdentityLookupOperator;
  }): Promise<LookupPersonDetail>;
  findLookupActivity(input: {
    operator: IdentityLookupOperator;
  }): Promise<LookupOperatorActivityRow[]>;
  findDomainClaimQueue(input: { operator: IdentityLookupOperator }): Promise<LookupDomainClaim[]>;
  confirmProposedSignIn(input: {
    userId: string;
    proposalId: string;
    operator: IdentityLookupOperator;
  }): Promise<void>;
  rejectProposedSignIn(input: {
    userId: string;
    proposalId: string;
    operator: IdentityLookupOperator;
  }): Promise<void>;
  detachLookupMethod(input: {
    userId: string;
    identifierId: string;
    operator: IdentityLookupOperator;
  }): Promise<void>;
  /** A null `identifierId` ends every session; an id ends that method's. */
  endLookupSessions(input: {
    userId: string;
    identifierId: string | null;
    operator: IdentityLookupOperator;
  }): Promise<void>;
  resendLookupInvitation(input: {
    organizationId: string;
    inviteId: string;
    operator: IdentityLookupOperator;
  }): Promise<LookupInvitationExpiry>;
  extendLookupInvitation(input: {
    organizationId: string;
    inviteId: string;
    operator: IdentityLookupOperator;
  }): Promise<LookupInvitationExpiry>;
}

export const IdentityLookupApi = moduleApi<IdentityLookupApi>()("identity");
