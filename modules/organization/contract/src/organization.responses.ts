/** Contract schemas for the organization feature's tRPC responses. */
import { z } from "zod";

/** A write with nothing else to report. */
export const organizationWriteAckSchema = z.object({ success: z.literal(true) }).strict();
export type OrganizationWriteAck = z.infer<typeof organizationWriteAckSchema>;

/** The organization and its first team were created. */
export const organizationCreatedSchema = z
  .object({
    success: z.literal(true),
    organization: z.object({ id: z.string().min(1), name: z.string() }).strict(),
    team: z.object({ id: z.string().min(1), slug: z.string().min(1), name: z.string() }).strict(),
  })
  .strict();
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
    role: z.enum(["ADMIN", "MEMBER", "EXTERNAL"]),
    requestedBy: z.string().nullable(),
    subscriptionId: z.string().nullable(),
    acceptedByUserId: z.string().nullable(),
    acceptedViaIdentifierId: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

/** One created invitation, and whether its email actually went out. */
export const organizationInviteCreatedSchema = z
  .object({ invite: organizationInviteRowSchema, emailNotSent: z.boolean(), inviteUrl: z.string() })
  .strict();
export type OrganizationInviteCreated = z.infer<typeof organizationInviteCreatedSchema>;
export const organizationInvitesCreatedSchema = organizationInviteCreatedSchema.array();

/** A resent invitation: the row, whether the email went out, and its accept link. */
export const organizationInviteResentSchema = organizationInviteCreatedSchema;
export type OrganizationInviteResent = z.infer<typeof organizationInviteResentSchema>;

/** An extended invitation: the same row and code, with a fresh expiry. */
export const organizationInviteExtendedSchema = z
  .object({ invite: organizationInviteRowSchema })
  .strict();
export type OrganizationInviteExtended = z.infer<typeof organizationInviteExtendedSchema>;

/** One pending invitation, as the members screen's admin list renders it. */
export const organizationListedInviteSchema = organizationInviteRowSchema
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
export type OrganizationListedInvite = z.infer<typeof organizationListedInviteSchema>;
export const organizationListedInvitesSchema = organizationListedInviteSchema.array();

/** What the accepting browser reads: the organization's name and the project to land on. */
export const organizationInviteAcceptedSchema = z.object({
  success: z.literal(true),
  invite: z.object({
    organization: z.object({ id: z.string().min(1), name: z.string() }),
  }),
  project: z.object({ slug: z.string().min(1) }).nullable(),
});
export type OrganizationInviteAccepted = z.infer<typeof organizationInviteAcceptedSchema>;

/**
 * The invitation a signed-in person who belongs to no organization is sent to,
 * instead of the screen that creates one. `inviteCode` is null when none waits.
 */
export const organizationPendingInvitationForCallerSchema = z.object({
  inviteCode: z.string().min(1).nullable(),
});
export type PendingInvitationForCaller = z.infer<
  typeof organizationPendingInvitationForCallerSchema
>;

/** The user row, flat. Mirrors `User` in `organization.rows.ts`. */
export const organizationUserRowSchema = z
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

/** One person in a picker: who they are and whether the account is switched off. */
export const organizationMemberUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().nullable(),
  deactivatedAt: z.date().nullable(),
});
export type OrganizationMemberUser = z.infer<typeof organizationMemberUserSchema>;
export const organizationUserRowsSchema = organizationMemberUserSchema.array();

/** One member as the person drawer opens them: the seat, and the fields it shows. */
export const organizationMemberRecordSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER", "EXTERNAL"]),
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
export type OrganizationMemberRecord = z.infer<typeof organizationMemberRecordSchema>;

/**
 * The member directory as the browser reads it: names and addresses, no
 * secrets. Plain objects, so a parse drops any key not declared here.
 */
export const organizationMemberDirectorySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  members: z.array(
    z.object({
      userId: z.string().min(1),
      organizationId: z.string().min(1),
      role: z.enum(["ADMIN", "MEMBER", "EXTERNAL"]),
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
export type OrganizationMemberDirectory = z.infer<typeof organizationMemberDirectorySchema>;

/** The numbers the Directory's tabs carry, each one a count and never a list. */
export const organizationDirectoryCountsSchema = z
  .object({
    members: z.number().int().nonnegative(),
    openInvites: z.number().int().nonnegative(),
    joinRequests: z.number().int().nonnegative(),
    groups: z.number().int().nonnegative(),
    teams: z.number().int().nonnegative(),
  })
  .strict();
export type OrganizationDirectoryCounts = z.infer<typeof organizationDirectoryCountsSchema>;

/** A member role change, and which shared teams it left without an admin. */
export const organizationMemberRoleChangedSchema = z
  .object({
    success: z.literal(true),
    teamsLeftWithoutAdmin: z.array(z.object({ id: z.string().min(1), name: z.string() }).strict()),
  })
  .strict();
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
  })
  .strict();

/** One page of the organization's audit trail. */
export const organizationAuditLogPageSchema = z
  .object({
    auditLogs: z.array(organizationAuditLogEntrySchema),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();
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
export const organizationMemberProvenanceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("directory"), providerId: z.string().nullable() }),
  z.object({ source: z.literal("domain"), domain: z.string(), automatic: z.boolean() }),
  z.object({ source: z.literal("invited") }),
  z.object({ source: z.literal("unknown") }),
]);
export type OrganizationMemberProvenance = z.infer<typeof organizationMemberProvenanceSchema>;

/** Every member's provenance, keyed by user id; everybody asked about has an answer. */
export const organizationMemberProvenanceByUserSchema = z.record(
  z.string(),
  organizationMemberProvenanceSchema,
);
