/**
 * What the organization feature's tRPC transport answers, stated once.
 *
 * The chain declares each procedure's `withOutput` from here, so the shape a
 * client reads is written down in the contract rather than implied by
 * whatever a handler happened to return. The schemas are checked against
 * real answers in development and test; production returns the handler's
 * own value.
 *
 * Three procedures on this surface (`getAll`, `getOrganizationWithMembersAndTheirTeams`,
 * `getMemberById`) answer with a deeply nested cross-row aggregate — Organization
 * joined to Team, TeamUser, CustomRole, the project feature's Project row and
 * User, several of them mutated in place for per-viewer redaction — that has
 * no existing contract schema. Giving `organization.rows.ts`'s row types their
 * own zod schemas is a follow-up in its own right; those three stay
 * `withoutOutput` until then.
 */
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

/**
 * The organization row, flat. Mirrors `Organization` in `organization.rows.ts`
 * without its two nested collections (`members`, `teams`), which is the shape
 * this surface actually nests an invite's organization inside.
 */
const organizationRowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    phoneNumber: z.string().nullable(),
    slug: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
    usageSpendingMaxLimit: z.number().nullable(),
    maxSessionDurationDays: z.number(),
    mfaRequired: z.boolean(),
    signupData: z.unknown().nullable(),
    signedDPA: z.boolean(),
    elasticsearchNodeUrl: z.string().nullable(),
    elasticsearchApiKey: z.string().nullable(),
    useCustomElasticsearch: z.boolean(),
    s3Endpoint: z.string().nullable(),
    s3AccessKeyId: z.string().nullable(),
    s3SecretAccessKey: z.string().nullable(),
    s3Bucket: z.string().nullable(),
    useCustomS3: z.boolean(),
    sentPlanLimitAlert: z.date().nullable(),
    ssoDomain: z.string().nullable(),
    ssoProvider: z.string().nullable(),
    domainJoin: z.string(),
    joinDomains: z.array(z.string()),
    presenceEnabled: z.boolean(),
    traceSharingEnabled: z.boolean(),
    supportContact: z.string().nullable(),
    primaryIntent: z.string().nullable(),
    promoCode: z.string().nullable(),
    stripeCustomerId: z.string().nullable(),
    currency: z.string(),
    pricingModel: z.string(),
    license: z.string().nullable(),
    licenseExpiresAt: z.date().nullable(),
    licenseLastValidatedAt: z.date().nullable(),
  })
  .strict();

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

/** One pending invitation, as the members screen's admin list renders it. */
export const organizationListedInviteSchema = organizationInviteRowSchema
  .extend({
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

/** The invite the acceptance ceremony resolved, and the project (if any) the caller lands on. */
export const organizationInviteAcceptedSchema = z
  .object({
    success: z.literal(true),
    invite: organizationInviteRowSchema.extend({ organization: organizationRowSchema }),
    project: z
      .object({ slug: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict();
export type OrganizationInviteAccepted = z.infer<typeof organizationInviteAcceptedSchema>;

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
export const organizationUserRowsSchema = organizationUserRowSchema.array();

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
