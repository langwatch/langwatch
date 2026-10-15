import { ledgerActorSchema } from "@langwatch/authorization";
import { moduleApi, type Named } from "@langwatch/module";
import { z } from "zod";

import { IDENTITY_EVENT_TYPES, linkProposalReasonSchema } from "./facts.ts";
import { identifierProviderSchema } from "./vocabulary.ts";

/** D05 tier 1: one address, five operator panels (ADR-117 §1, §3). */
export const IDENTITY_LOOKUP_HISTORY_LIMIT = 50;
export const OPERATOR_ACTIVITY_LIMIT = 50;
export const DOMAIN_CLAIM_QUEUE_LIMIT = 50;

/** The prefix every act on this surface is recorded under. */
export const IDENTITY_LOOKUP_AUDIT_PREFIX = "identityLookup.";

/** The address as a support case arrives holding it. */
export const identityLookupAddressSchema = z.string().min(1).max(254);

const lookupIdentifierSchemaDefinition = z.object({
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
export interface LookupIdentifierSchema extends Named<typeof lookupIdentifierSchemaDefinition> {}
export const lookupIdentifierSchema: LookupIdentifierSchema = lookupIdentifierSchemaDefinition;
export type LookupIdentifier = z.infer<typeof lookupIdentifierSchema>;

const lookupPersonSchemaDefinition = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  organizations: z.array(
    z.object({ organizationId: z.string(), name: z.string().nullable(), role: z.string() }),
  ),
  /** How this person holds the address that was looked up. */
  holding: z.array(lookupIdentifierSchema),
});
export interface LookupPersonSchema extends Named<typeof lookupPersonSchemaDefinition> {}
export const lookupPersonSchema: LookupPersonSchema = lookupPersonSchemaDefinition;
export type LookupPerson = z.infer<typeof lookupPersonSchema>;

/** The domain-owning connection, named beside the routing decision. */
const lookupConnectionSchemaDefinition = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  organizationName: z.string().nullable(),
  state: z.string(),
  providerId: z.string(),
  ownershipProof: z.enum(["QUALIFIED", "UNKNOWN", "LAPSED"]),
  routeKind: z.enum(["legacy-configuration", "connection"]),
});
export interface LookupConnectionSchema extends Named<typeof lookupConnectionSchemaDefinition> {}
export const lookupConnectionSchema: LookupConnectionSchema = lookupConnectionSchemaDefinition;
export type LookupConnection = z.infer<typeof lookupConnectionSchema>;

const lookupRoutingSchemaDefinition = z.object({
  outcome: z.string(),
  reasonCode: z.string(),
  connectionId: z.string().nullable(),
  methods: z.array(z.string()),
  connection: lookupConnectionSchema.nullable(),
});
export interface LookupRoutingSchema extends Named<typeof lookupRoutingSchemaDefinition> {}
export const lookupRoutingSchema: LookupRoutingSchema = lookupRoutingSchemaDefinition;
export type LookupRouting = z.infer<typeof lookupRoutingSchema>;

const identityLookupAnswerSchemaDefinition = z.object({
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
export interface IdentityLookupAnswerSchema extends Named<
  typeof identityLookupAnswerSchemaDefinition
> {}
export const identityLookupAnswerSchema: IdentityLookupAnswerSchema =
  identityLookupAnswerSchemaDefinition;
export type IdentityLookupAnswer = z.infer<typeof identityLookupAnswerSchema>;

const lookupInvitationSchemaDefinition = z.object({
  inviteId: z.string(),
  email: z.string(),
  organizationId: z.string(),
  organizationName: z.string().nullable(),
  invitedByName: z.string().nullable(),
  status: z.string(),
  expiresAtMs: z.number().nullable(),
  isExpired: z.boolean(),
});
export interface LookupInvitationSchema extends Named<typeof lookupInvitationSchemaDefinition> {}
export const lookupInvitationSchema: LookupInvitationSchema = lookupInvitationSchemaDefinition;
export type LookupInvitation = z.infer<typeof lookupInvitationSchema>;

const lookupDomainClaimSchemaDefinition = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
  organizationName: z.string().nullable(),
  domain: z.string(),
  waitingSinceMs: z.number(),
});
export interface LookupDomainClaimSchema extends Named<typeof lookupDomainClaimSchemaDefinition> {}
export const lookupDomainClaimSchema: LookupDomainClaimSchema = lookupDomainClaimSchemaDefinition;
export type LookupDomainClaim = z.infer<typeof lookupDomainClaimSchema>;

/** A proposal folded out of its facts; `decision` is null until one is stated. */
const linkProposalRecordSchemaDefinition = z.object({
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
export interface LinkProposalRecordSchema extends Named<
  typeof linkProposalRecordSchemaDefinition
> {}
export const linkProposalRecordSchema: LinkProposalRecordSchema =
  linkProposalRecordSchemaDefinition;
export type LinkProposalRecord = z.infer<typeof linkProposalRecordSchema>;

const lookupWaitingSchemaDefinition = z.object({
  proposals: z.array(linkProposalRecordSchema),
  invitations: z.array(lookupInvitationSchema),
  domainClaims: z.array(lookupDomainClaimSchema),
  isEmpty: z.boolean(),
});
export interface LookupWaitingSchema extends Named<typeof lookupWaitingSchemaDefinition> {}
export const lookupWaitingSchema: LookupWaitingSchema = lookupWaitingSchemaDefinition;
export type LookupWaiting = z.infer<typeof lookupWaitingSchema>;

/** One identity fact as an operator reads it: ids, enums, times, never a secret. */
const identityHistoryEntrySchemaDefinition = z.object({
  eventId: z.string(),
  type: z.enum(IDENTITY_EVENT_TYPES),
  occurredAtMs: z.number(),
  actor: ledgerActorSchema,
  identifierId: z.string().nullable(),
  provider: z.string().nullable(),
  value: z.string().nullable(),
  domain: z.string().nullable(),
  connectionId: z.string().nullable(),
  proposalId: z.string().nullable(),
  detail: z.string().nullable(),
});
export interface IdentityHistoryEntrySchema extends Named<
  typeof identityHistoryEntrySchemaDefinition
> {}
export const identityHistoryEntrySchema: IdentityHistoryEntrySchema =
  identityHistoryEntrySchemaDefinition;
export type IdentityHistoryEntry = z.infer<typeof identityHistoryEntrySchema>;

const lookupSessionSchemaDefinition = z.object({
  sessionId: z.string(),
  identifierId: z.string().nullable(),
  createdAtMs: z.number(),
  expiresAtMs: z.number(),
});
export interface LookupSessionSchema extends Named<typeof lookupSessionSchemaDefinition> {}
export const lookupSessionSchema: LookupSessionSchema = lookupSessionSchemaDefinition;
export type LookupSession = z.infer<typeof lookupSessionSchema>;

const lookupPersonDetailSchemaDefinition = z.object({
  person: lookupPersonSchema,
  identifiers: z.array(lookupIdentifierSchema),
  waiting: lookupWaitingSchema,
  history: z.array(identityHistoryEntrySchema),
  sessions: z.array(lookupSessionSchema),
});
export interface LookupPersonDetailSchema extends Named<
  typeof lookupPersonDetailSchemaDefinition
> {}
export const lookupPersonDetailSchema: LookupPersonDetailSchema =
  lookupPersonDetailSchemaDefinition;
export type LookupPersonDetail = z.infer<typeof lookupPersonDetailSchema>;

/** One operator act, read off the same trail every repair writes to. */
const lookupOperatorActivityRowSchemaDefinition = z.object({
  auditId: z.string(),
  operatorUserId: z.string().nullable(),
  operatorName: z.string().nullable(),
  act: z.string(),
  address: z.string().nullable(),
  atMs: z.number(),
});
export interface LookupOperatorActivityRowSchema extends Named<
  typeof lookupOperatorActivityRowSchemaDefinition
> {}
export const lookupOperatorActivityRowSchema: LookupOperatorActivityRowSchema =
  lookupOperatorActivityRowSchemaDefinition;
export type LookupOperatorActivityRow = z.infer<typeof lookupOperatorActivityRowSchema>;

const lookupInvitationExpirySchemaDefinition = z.object({ expiresAtMs: z.number().nullable() });
export interface LookupInvitationExpirySchema extends Named<
  typeof lookupInvitationExpirySchemaDefinition
> {}
export const lookupInvitationExpirySchema: LookupInvitationExpirySchema =
  lookupInvitationExpirySchemaDefinition;
export type LookupInvitationExpiry = z.infer<typeof lookupInvitationExpirySchema>;

/** Whoever asked: the impersonator when there is one. */
export type IdentityLookupOperator = Readonly<{ userId: string }>;

/** A domain a person proved through a verified or primary identifier. */
export interface VerifiedUserDomain {
  userId: string;
  domain: string;
}

/**
 * The platform operator's identity lookup (D05). The door admits only ops:manage
 * at the platform and hides the surface from everyone else; every act is recorded.
 */
export interface IdentityLookupApi {
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
  /** A caller the door refused (Q51): recorded within a shared stranger budget, never thrown. */
  recordRefusedLookup(input: {
    operator: IdentityLookupOperator;
    action: string;
    args: Readonly<Record<string, string | null>>;
  }): Promise<void>;
}

export const IdentityLookupApi = moduleApi<IdentityLookupApi>()("identity");
