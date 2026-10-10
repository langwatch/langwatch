import type { Named } from "@langwatch/module";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

export const organizationIdSchema = z.string().min(1);

/** The KSUID resource every organization id is born under, whichever module mints it. */
export const ORGANIZATION_KSUID_RESOURCE = "organization";

export const organizationIntentSchema = z.enum(["AGENT_GOVERNANCE", "LLM_OPS"]);
export type OrganizationIntent = z.infer<typeof organizationIntentSchema>;

const getOrganizationSettingsInputSchemaDefinition = z
  .object({ organizationId: organizationIdSchema })
  .strict();
export interface GetOrganizationSettingsInputSchema extends Named<
  typeof getOrganizationSettingsInputSchemaDefinition
> {}
export const getOrganizationSettingsInputSchema: GetOrganizationSettingsInputSchema =
  getOrganizationSettingsInputSchemaDefinition;
export type GetOrganizationSettingsInput = z.infer<typeof getOrganizationSettingsInputSchema>;

const updateOrganizationSettingsInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    name: z.string().optional(),
    supportContact: z.string().nullable().optional(),
    presenceEnabled: z.boolean().optional(),
    traceSharingEnabled: z.boolean().optional(),
    primaryIntent: organizationIntentSchema.nullable().optional(),
    s3Endpoint: z.string().nullable().optional(),
    s3AccessKeyId: z.string().nullable().optional(),
    s3SecretAccessKey: z.string().nullable().optional(),
    s3Bucket: z.string().nullable().optional(),
  })
  .strict();
export interface UpdateOrganizationSettingsInputSchema extends Named<
  typeof updateOrganizationSettingsInputSchemaDefinition
> {}
export const updateOrganizationSettingsInputSchema: UpdateOrganizationSettingsInputSchema =
  updateOrganizationSettingsInputSchemaDefinition;
export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsInputSchema>;

const organizationSettingsSchemaDefinition = z
  .object({
    id: organizationIdSchema,
    name: z.string(),
    slug: z.string(),
    supportContact: z.string().nullable(),
    presenceEnabled: z.boolean(),
    traceSharingEnabled: z.boolean(),
    primaryIntent: organizationIntentSchema.nullable(),
    s3Endpoint: z.string().nullable(),
    s3AccessKeyId: z.string().nullable(),
    s3Bucket: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface OrganizationSettingsSchema extends Named<
  typeof organizationSettingsSchemaDefinition
> {}
export const organizationSettingsSchema: OrganizationSettingsSchema =
  organizationSettingsSchemaDefinition;
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

const updateOrganizationSettingsResultSchemaDefinition = z
  .object({ traceShareRevocationRequired: z.boolean() })
  .strict();
export interface UpdateOrganizationSettingsResultSchema extends Named<
  typeof updateOrganizationSettingsResultSchemaDefinition
> {}
export const updateOrganizationSettingsResultSchema: UpdateOrganizationSettingsResultSchema =
  updateOrganizationSettingsResultSchemaDefinition;
export type UpdateOrganizationSettingsResult = z.infer<
  typeof updateOrganizationSettingsResultSchema
>;

/**
 * Resolving the tenant behind one team. Answers `null` for a missing team,
 * and an ARCHIVED team's organization the same as a live one's — usage
 * metering and personal-workspace reads need a tenant regardless.
 */
const getOrganizationIdByTeamIdInputSchemaDefinition = z
  .object({ teamId: z.string().min(1) })
  .strict();
export interface GetOrganizationIdByTeamIdInputSchema extends Named<
  typeof getOrganizationIdByTeamIdInputSchemaDefinition
> {}
export const getOrganizationIdByTeamIdInputSchema: GetOrganizationIdByTeamIdInputSchema =
  getOrganizationIdByTeamIdInputSchemaDefinition;
export type GetOrganizationIdByTeamIdInput = z.infer<typeof getOrganizationIdByTeamIdInputSchema>;

const getOrganizationMembersInputSchemaDefinition = z
  .object({
    organizationId: organizationIdSchema,
    userIds: z.array(z.string().min(1)),
  })
  .strict();
export interface GetOrganizationMembersInputSchema extends Named<
  typeof getOrganizationMembersInputSchemaDefinition
> {}
export const getOrganizationMembersInputSchema: GetOrganizationMembersInputSchema =
  getOrganizationMembersInputSchemaDefinition;
export type GetOrganizationMembersInput = z.infer<typeof getOrganizationMembersInputSchema>;

const getOldestTeamInputSchemaDefinition = z.object({
  organizationId: organizationIdSchema,
});
export interface GetOldestTeamInputSchema extends Named<
  typeof getOldestTeamInputSchemaDefinition
> {}
export const getOldestTeamInputSchema: GetOldestTeamInputSchema =
  getOldestTeamInputSchemaDefinition;

export type GetOldestTeamInput = z.infer<typeof getOldestTeamInputSchema>;

const getOrganizationBillingProfileInputSchemaDefinition = z
  .object({ organizationId: organizationIdSchema })
  .strict();
export interface GetOrganizationBillingProfileInputSchema extends Named<
  typeof getOrganizationBillingProfileInputSchemaDefinition
> {}
export const getOrganizationBillingProfileInputSchema: GetOrganizationBillingProfileInputSchema =
  getOrganizationBillingProfileInputSchemaDefinition;
export type GetOrganizationBillingProfileInput = z.infer<
  typeof getOrganizationBillingProfileInputSchema
>;

const organizationBillingProfileSchemaDefinition = z
  .object({
    id: organizationIdSchema,
    name: z.string(),
    billingCustomerId: z.string().min(1).nullable(),
  })
  .strict();
export interface OrganizationBillingProfileSchema extends Named<
  typeof organizationBillingProfileSchemaDefinition
> {}
export const organizationBillingProfileSchema: OrganizationBillingProfileSchema =
  organizationBillingProfileSchemaDefinition;
export type OrganizationBillingProfile = z.infer<typeof organizationBillingProfileSchema>;

/** Audit log row with resolved actor and project; nullable userId for system actors. */
export type EnrichedAuditLog = {
  id: string;
  createdAt: Instant;
  /** Nullable to support system-actor writes (background jobs, migrations). */
  userId: string | null;
  organizationId: string | null;
  projectId: string | null;
  action: string;
  payload: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  error: string | null;
  args: unknown;
  user: { id: string; name: string | null; email: string | null } | null;
  project: { id: string; name: string } | null;
  /** Computed: gateway = `targetKind` populated, platform = otherwise. */
  source: "platform" | "gateway";
  /** Gateway resource kind — only set when source="gateway". */
  targetKind: string | null;
  /** Gateway resource id — only set when source="gateway". */
  targetId: string | null;
  /** Gateway-side diff (before state). Only set when source="gateway". */
  before: unknown;
  /** Gateway-side diff (after state). Only set when source="gateway". */
  after: unknown;
  /** Who really acted when that is not `userId` (an operator impersonating). */
  actorUserId: string | null;
  actorUser: { id: string; name: string | null; email: string | null } | null;
  /** Which door the change came through: the app's own calls or the public API (E11). */
  channel: AuditChannel | null;
  /** The API key the call presented: a service key acting alone, or a person's own key. */
  apiKeyId: string | null;
};

/** The door an audit row came through. */
export const auditChannelSchema = z.enum(["app", "api"]);
export type AuditChannel = z.infer<typeof auditChannelSchema>;

/** What the tRPC door writes into an impersonated audit row's metadata. */
const auditImpersonationMetadataSchemaDefinition = z.object({ impersonatorId: z.string().min(1) });
export interface AuditImpersonationMetadataSchema extends Named<
  typeof auditImpersonationMetadataSchemaDefinition
> {}
export const auditImpersonationMetadataSchema: AuditImpersonationMetadataSchema =
  auditImpersonationMetadataSchemaDefinition;

/**
 * How colleagues on a matching domain get into an organization; identity's join ledger
 * reads and writes it through OrganizationApi. Keep in step with
 * `modules/identity/contract/src/features/join-request/join-matching.ts`.
 */

const organizationJoinSettingSchemaDefinition = z
  .object({
    domainJoin: z.enum(["off", "request", "auto"]),
    joinDomains: z.array(z.string()),
    joinerRole: z.enum(["MEMBER", "DEVELOPER"]),
  })
  .strict();
export interface OrganizationJoinSettingSchema extends Named<
  typeof organizationJoinSettingSchemaDefinition
> {}
export const organizationJoinSettingSchema: OrganizationJoinSettingSchema =
  organizationJoinSettingSchemaDefinition;
export type OrganizationJoinSetting = z.infer<typeof organizationJoinSettingSchema>;

/** Where a join request was made (ADR-171 v6), written on a Developer admission's audit row. */
export const organizationJoinOriginSchema = z.enum(["web", "cli"]);
export type OrganizationJoinOrigin = z.infer<typeof organizationJoinOriginSchema>;

/**
 * The two sign-in security rules an organization sets, in the four columns it
 * owns: account lockout (GAC-09) and session limits (GAC-10).
 * specs/identity/org-account-lockout.feature, specs/identity/org-session-lifetime.feature
 */

const signInSecurityPolicySchemaDefinition = z.object({
  /** Consecutive failures before a lock. 0 = never lock. */
  lockoutAfterFailedAttempts: z.number().int().min(0).max(20),
  /** How long a lock lasts, in minutes. */
  lockoutMinutes: z.number().int().min(1).max(1440),
  /** Minutes a session may sit idle before it ends. 0 = no idle timeout. */
  sessionIdleTimeoutMinutes: z.number().int().min(0).max(10080),
  /** Minutes from sign-in after which a session ends regardless. 0 = no ceiling. */
  sessionMaxLifetimeMinutes: z.number().int().min(0).max(10080),
});
export interface SignInSecurityPolicySchema extends Named<
  typeof signInSecurityPolicySchemaDefinition
> {}
export const signInSecurityPolicySchema: SignInSecurityPolicySchema =
  signInSecurityPolicySchemaDefinition;
export type SignInSecurityPolicy = z.infer<typeof signInSecurityPolicySchema>;

/**
 * Who may create an account on this installation, and who may found an
 * organization once they have one (specs/auth/sign-up-restriction.feature).
 */

/** `open` admits anybody who reaches the installation; `invite_only` admits invited addresses. */
export type SignUpMode = "open" | "invite_only";

export type SignUpVerdict =
  | {
      allowed: true;
      via: "open" | "instance_admin" | "invitation" | "first_account";
    }
  | { allowed: false; reason: "invite_only" | "domain_not_allowed" };

export type OrganizationCreationVerdict =
  | { allowed: true; via: "open" | "instance_admin" | "first_organization" }
  | { allowed: false; reason: "invite_only" };
