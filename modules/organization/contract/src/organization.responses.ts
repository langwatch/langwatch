import type { Named } from "@langwatch/module";
/** Contract schemas for the organization feature's tRPC responses. */
import { z } from "zod";

import { auditChannelSchema } from "./organization.ts";

/** A write with nothing else to report. */
const organizationWriteAckSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface OrganizationWriteAckSchema extends Named<
  typeof organizationWriteAckSchemaDefinition
> {}
export const organizationWriteAckSchema: OrganizationWriteAckSchema =
  organizationWriteAckSchemaDefinition;
export type OrganizationWriteAck = z.infer<typeof organizationWriteAckSchema>;

/** The organization and its first team were created. */
const organizationCreatedSchemaDefinition = z
  .object({
    success: z.literal(true),
    organization: z.object({ id: z.string().min(1), name: z.string() }).strict(),
    team: z.object({ id: z.string().min(1), slug: z.string().min(1), name: z.string() }).strict(),
  })
  .strict();
export interface OrganizationCreatedSchema extends Named<
  typeof organizationCreatedSchemaDefinition
> {}
export const organizationCreatedSchema: OrganizationCreatedSchema =
  organizationCreatedSchemaDefinition;
export type OrganizationCreated = z.infer<typeof organizationCreatedSchema>;

/** The invite row, flat. Mirrors `OrganizationInvite` in `organization.rows.ts`. */
const organizationInviteRowSchema = z
  .object({
    id: z.string().min(1),
    email: z.string(),
    inviteCode: z.string(),
    expiration: z.date().nullable(),
    status: z.enum(["PENDING", "ACCEPTED", "WAITING_APPROVAL", "PAYMENT_PENDING", "REVOKED"]),
    organizationId: z.string().min(1),
    teamIds: z.string(),
    teamAssignments: z.unknown().nullable(),
    role: z.enum(["ADMIN", "MEMBER", "EXTERNAL", "DEVELOPER"]),
    requestedBy: z.string().nullable(),
    subscriptionId: z.string().nullable(),
    acceptedByUserId: z.string().nullable(),
    acceptedViaIdentifierId: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

/** One created invitation, and whether its email actually went out. */
const organizationInviteCreatedSchemaDefinition = z
  .object({ invite: organizationInviteRowSchema, emailNotSent: z.boolean(), inviteUrl: z.string() })
  .strict();
export interface OrganizationInviteCreatedSchema extends Named<
  typeof organizationInviteCreatedSchemaDefinition
> {}
export const organizationInviteCreatedSchema: OrganizationInviteCreatedSchema =
  organizationInviteCreatedSchemaDefinition;
export type OrganizationInviteCreated = z.infer<typeof organizationInviteCreatedSchema>;
const organizationInvitesCreatedSchemaDefinition = organizationInviteCreatedSchema.array();
export interface OrganizationInvitesCreatedSchema extends Named<
  typeof organizationInvitesCreatedSchemaDefinition
> {}
export const organizationInvitesCreatedSchema: OrganizationInvitesCreatedSchema =
  organizationInvitesCreatedSchemaDefinition;

/** A resent invitation: the row, whether the email went out, and its accept link. */
export const organizationInviteResentSchema = organizationInviteCreatedSchema;
export type OrganizationInviteResent = z.infer<typeof organizationInviteResentSchema>;

/** An extended invitation: the same row and code, with a fresh expiry. */
const organizationInviteExtendedSchemaDefinition = z
  .object({ invite: organizationInviteRowSchema })
  .strict();
export interface OrganizationInviteExtendedSchema extends Named<
  typeof organizationInviteExtendedSchemaDefinition
> {}
export const organizationInviteExtendedSchema: OrganizationInviteExtendedSchema =
  organizationInviteExtendedSchemaDefinition;
export type OrganizationInviteExtended = z.infer<typeof organizationInviteExtendedSchema>;

/** One pending invitation, as the members screen's admin list renders it. */
const organizationListedInviteSchemaDefinition = organizationInviteRowSchema
  .safeExtend({
    inviteUrl: z.string(),
    displayStatus: z.enum([
      "PENDING",
      "ACCEPTED",
      "EXPIRED",
      "REVOKED",
      "WAITING_APPROVAL",
      "PAYMENT_PENDING",
    ]),
    requestedByUser: z
      .object({ id: z.string().min(1), name: z.string().nullable(), email: z.string().nullable() })
      .strict()
      .nullable(),
  })
  .strict();
export interface OrganizationListedInviteSchema extends Named<
  typeof organizationListedInviteSchemaDefinition
> {}
export const organizationListedInviteSchema: OrganizationListedInviteSchema =
  organizationListedInviteSchemaDefinition;
export type OrganizationListedInvite = z.infer<typeof organizationListedInviteSchema>;
const organizationListedInvitesSchemaDefinition = organizationListedInviteSchema.array();
export interface OrganizationListedInvitesSchema extends Named<
  typeof organizationListedInvitesSchemaDefinition
> {}
export const organizationListedInvitesSchema: OrganizationListedInvitesSchema =
  organizationListedInvitesSchemaDefinition;

/** What the accepting browser reads: the organization's name and the project to land on. */
const organizationInviteAcceptedSchemaDefinition = z.object({
  success: z.literal(true),
  invite: z.object({
    organization: z.object({ id: z.string().min(1), name: z.string() }),
  }),
  project: z.object({ slug: z.string().min(1) }).nullable(),
});
export interface OrganizationInviteAcceptedSchema extends Named<
  typeof organizationInviteAcceptedSchemaDefinition
> {}
export const organizationInviteAcceptedSchema: OrganizationInviteAcceptedSchema =
  organizationInviteAcceptedSchemaDefinition;
export type OrganizationInviteAccepted = z.infer<typeof organizationInviteAcceptedSchema>;

/**
 * What an invitation link may say to whoever opens it: which organization is
 * asking, and who asked — enough to decide, but nothing that makes a guessed
 * code worth guessing (no address, no role, no membership).
 */
const inviteLandingSchemaDefinition = z
  .object({
    organizationName: z.string(),
    inviterName: z.string().nullable(),
    alreadyAccepted: z.boolean(),
  })
  .strict();
export interface InviteLandingSchema extends Named<typeof inviteLandingSchemaDefinition> {}
export const inviteLandingSchema: InviteLandingSchema = inviteLandingSchemaDefinition;
export type InviteLanding = z.infer<typeof inviteLandingSchema>;

/**
 * The invitation a signed-in person who belongs to no organization is sent to,
 * instead of the screen that creates one. `inviteCode` is null when none waits.
 */
const organizationPendingInvitationForCallerSchemaDefinition = z.object({
  inviteCode: z.string().min(1).nullable(),
});
export interface OrganizationPendingInvitationForCallerSchema extends Named<
  typeof organizationPendingInvitationForCallerSchemaDefinition
> {}
export const organizationPendingInvitationForCallerSchema: OrganizationPendingInvitationForCallerSchema =
  organizationPendingInvitationForCallerSchemaDefinition;
export type PendingInvitationForCaller = z.infer<
  typeof organizationPendingInvitationForCallerSchema
>;

/**
 * Every pending invitation on one address, in any organization, expired ones included: the
 * operator's identity lookup reads it (main's read). Carries no invitation code.
 */
const organizationPendingInvitationsByEmailSchemaDefinition = z.array(
  z.object({
    inviteId: z.string().min(1),
    email: z.string(),
    organizationId: z.string().min(1),
    organizationName: z.string().nullable(),
    invitedByName: z.string().nullable(),
    expiresAtMs: z.number().nullable(),
  }),
);
export interface OrganizationPendingInvitationsByEmailSchema extends Named<
  typeof organizationPendingInvitationsByEmailSchemaDefinition
> {}
export const organizationPendingInvitationsByEmailSchema: OrganizationPendingInvitationsByEmailSchema =
  organizationPendingInvitationsByEmailSchemaDefinition;
export type PendingInvitationsByEmail = z.infer<typeof organizationPendingInvitationsByEmailSchema>;

/** The oldest pending invitation on each address the caller has proven (ADR-171 v6). */
const organizationPendingInvitationsForCallerSchemaDefinition = z.array(
  z.object({
    inviteCode: z.string().min(1),
    organizationName: z.string(),
    inviterName: z.string().nullable(),
    role: z.enum(["ADMIN", "MEMBER", "EXTERNAL", "DEVELOPER"]),
  }),
);
export interface OrganizationPendingInvitationsForCallerSchema extends Named<
  typeof organizationPendingInvitationsForCallerSchemaDefinition
> {}
export const organizationPendingInvitationsForCallerSchema: OrganizationPendingInvitationsForCallerSchema =
  organizationPendingInvitationsForCallerSchemaDefinition;
export type PendingInvitationsForCaller = z.infer<
  typeof organizationPendingInvitationsForCallerSchema
>;

/** The user row, flat. Mirrors `User` in `organization.rows.ts`. */
const organizationUserRowSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().nullable(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    pendingSsoSetup: z.boolean(),
    userHashKey: z.string().nullable(),
    twoFactorEnabled: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
    lastLoginAt: z.date().nullable(),
    deactivatedAt: z.date().nullable(),
    lastHomePath: z.string().nullable(),
    tracesExplorerTourDismissedAt: z.date().nullable(),
    passkeyNudgeDismissedAt: z.date().nullable(),
  })
  .strict();
export interface OrganizationUserRowSchema extends Named<
  typeof organizationUserRowSchemaDefinition
> {}
export const organizationUserRowSchema: OrganizationUserRowSchema =
  organizationUserRowSchemaDefinition;

/** One person in a picker: who they are and whether the account is switched off. */
const organizationMemberUserSchemaDefinition = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().nullable(),
  deactivatedAt: z.date().nullable(),
});
export interface OrganizationMemberUserSchema extends Named<
  typeof organizationMemberUserSchemaDefinition
> {}
export const organizationMemberUserSchema: OrganizationMemberUserSchema =
  organizationMemberUserSchemaDefinition;
export type OrganizationMemberUser = z.infer<typeof organizationMemberUserSchema>;
const organizationUserRowsSchemaDefinition = organizationMemberUserSchema.array();
export interface OrganizationUserRowsSchema extends Named<
  typeof organizationUserRowsSchemaDefinition
> {}
export const organizationUserRowsSchema: OrganizationUserRowsSchema =
  organizationUserRowsSchemaDefinition;

/** One member as the person drawer opens them: the seat, and the fields it shows. */
const organizationMemberRecordSchemaDefinition = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER", "EXTERNAL", "DEVELOPER"]),
  createdAt: z.date(),
  updatedAt: z.date(),
  departmentId: z.string().nullable(),
  disabledAt: z.date().nullable(),
  user: z.object({
    id: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().nullable(),
    image: z.string().nullable(),
    emailVerified: z.boolean(),
    deactivatedAt: z.date().nullable(),
  }),
});
export interface OrganizationMemberRecordSchema extends Named<
  typeof organizationMemberRecordSchemaDefinition
> {}
export const organizationMemberRecordSchema: OrganizationMemberRecordSchema =
  organizationMemberRecordSchemaDefinition;
export type OrganizationMemberRecord = z.infer<typeof organizationMemberRecordSchema>;

/**
 * The member directory as the browser reads it: names and addresses, no
 * secrets. Plain objects, so a parse drops any key not declared here.
 */
const organizationMemberDirectorySchemaDefinition = z.object({
  id: z.string().min(1),
  name: z.string(),
  members: z.array(
    z.object({
      userId: z.string().min(1),
      organizationId: z.string().min(1),
      role: z.enum(["ADMIN", "MEMBER", "EXTERNAL", "DEVELOPER"]),
      createdAt: z.date(),
      updatedAt: z.date(),
      departmentId: z.string().nullable(),
      disabledAt: z.date().nullable(),
      user: z.object({
        id: z.string().min(1),
        name: z.string().nullable(),
        email: z.string().nullable(),
        image: z.string().nullable(),
        deactivatedAt: z.date().nullable(),
      }),
    }),
  ),
});
export interface OrganizationMemberDirectorySchema extends Named<
  typeof organizationMemberDirectorySchemaDefinition
> {}
export const organizationMemberDirectorySchema: OrganizationMemberDirectorySchema =
  organizationMemberDirectorySchemaDefinition;
export type OrganizationMemberDirectory = z.infer<typeof organizationMemberDirectorySchema>;

/** The numbers the Directory's tabs carry, each one a count and never a list. */
const organizationDirectoryCountsSchemaDefinition = z
  .object({
    members: z.number().int().nonnegative(),
    openInvites: z.number().int().nonnegative(),
    joinRequests: z.number().int().nonnegative(),
    groups: z.number().int().nonnegative(),
    teams: z.number().int().nonnegative(),
  })
  .strict();
export interface OrganizationDirectoryCountsSchema extends Named<
  typeof organizationDirectoryCountsSchemaDefinition
> {}
export const organizationDirectoryCountsSchema: OrganizationDirectoryCountsSchema =
  organizationDirectoryCountsSchemaDefinition;
export type OrganizationDirectoryCounts = z.infer<typeof organizationDirectoryCountsSchema>;

/** A member role change, and which shared teams it left without an admin. */
const organizationMemberRoleChangedSchemaDefinition = z
  .object({
    success: z.literal(true),
    teamsLeftWithoutAdmin: z.array(z.object({ id: z.string().min(1), name: z.string() }).strict()),
  })
  .strict();
export interface OrganizationMemberRoleChangedSchema extends Named<
  typeof organizationMemberRoleChangedSchemaDefinition
> {}
export const organizationMemberRoleChangedSchema: OrganizationMemberRoleChangedSchema =
  organizationMemberRoleChangedSchemaDefinition;
export type OrganizationMemberRoleChanged = z.infer<typeof organizationMemberRoleChangedSchema>;

/** One audit log entry, enriched with the actor's and the project's display names. */
const organizationAuditLogEntrySchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.date(),
    userId: z.string().nullable(),
    organizationId: z.string().nullable(),
    projectId: z.string().nullable(),
    action: z.string(),
    payload: z.unknown(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    error: z.string().nullable(),
    args: z.unknown(),
    user: z
      .object({ id: z.string().min(1), name: z.string().nullable(), email: z.string().nullable() })
      .strict()
      .nullable(),
    project: z
      .object({ id: z.string().min(1), name: z.string() })
      .strict()
      .nullable(),
    source: z.enum(["platform", "gateway"]),
    targetKind: z.string().nullable(),
    targetId: z.string().nullable(),
    before: z.unknown(),
    after: z.unknown(),
    actorUserId: z.string().nullable(),
    actorUser: z
      .object({ id: z.string().min(1), name: z.string().nullable(), email: z.string().nullable() })
      .strict()
      .nullable(),
    channel: auditChannelSchema.nullable(),
    apiKeyId: z.string().nullable(),
  })
  .strict();

/** One page of the organization's audit trail. */
const organizationAuditLogPageSchemaDefinition = z
  .object({
    auditLogs: z.array(organizationAuditLogEntrySchema),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();
export interface OrganizationAuditLogPageSchema extends Named<
  typeof organizationAuditLogPageSchemaDefinition
> {}
export const organizationAuditLogPageSchema: OrganizationAuditLogPageSchema =
  organizationAuditLogPageSchemaDefinition;
export type OrganizationAuditLogPage = z.infer<typeof organizationAuditLogPageSchema>;

/**
 * Whether an arriving person already held a PENDING invitation here, and
 * which one. `applied: false` is a fact the caller acts on — it falls back to
 * a default membership — rather than an absence.
 */
export type OrganizationPendingInviteApplied =
  | Readonly<{ applied: true; inviteId: string }>
  | Readonly<{ applied: false }>;

/** Why one member is in the organization; `unknown` renders as no chip rather than a guess. */
const organizationMemberProvenanceSchemaDefinition = z.discriminatedUnion("source", [
  z.object({ source: z.literal("directory"), providerId: z.string().nullable() }),
  z.object({ source: z.literal("sso"), connectionId: z.string() }),
  z.object({ source: z.literal("domain"), domain: z.string(), automatic: z.boolean() }),
  z.object({ source: z.literal("invited") }),
  z.object({ source: z.literal("unknown") }),
]);
export interface OrganizationMemberProvenanceSchema extends Named<
  typeof organizationMemberProvenanceSchemaDefinition
> {}
export const organizationMemberProvenanceSchema: OrganizationMemberProvenanceSchema =
  organizationMemberProvenanceSchemaDefinition;
export type OrganizationMemberProvenance = z.infer<typeof organizationMemberProvenanceSchema>;

/** Every member's provenance, keyed by user id; everybody asked about has an answer. */
/** Organization's half of member provenance: its members, and whom an invitation brought. */
const organizationInvitedMemberIdsSchemaDefinition = z.object({
  memberUserIds: z.array(z.string()),
  invitedUserIds: z.array(z.string()),
});
export interface OrganizationInvitedMemberIdsSchema extends Named<
  typeof organizationInvitedMemberIdsSchemaDefinition
> {}
export const organizationInvitedMemberIdsSchema: OrganizationInvitedMemberIdsSchema =
  organizationInvitedMemberIdsSchemaDefinition;
export type OrganizationInvitedMemberIds = z.infer<typeof organizationInvitedMemberIdsSchema>;

const organizationMemberProvenanceByUserSchemaDefinition = z.record(
  z.string(),
  organizationMemberProvenanceSchema,
);
export interface OrganizationMemberProvenanceByUserSchema extends Named<
  typeof organizationMemberProvenanceByUserSchemaDefinition
> {}
export const organizationMemberProvenanceByUserSchema: OrganizationMemberProvenanceByUserSchema =
  organizationMemberProvenanceByUserSchemaDefinition;
