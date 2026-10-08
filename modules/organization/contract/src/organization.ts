import type { Instant } from "@langwatch/time";
import { z } from "zod";

export const organizationIdSchema = z.string().min(1);

export const organizationIntentSchema = z.enum(["AGENT_GOVERNANCE", "LLM_OPS"]);
export type OrganizationIntent = z.infer<typeof organizationIntentSchema>;

export const getOrganizationSettingsInputSchema = z
  .object({ organizationId: organizationIdSchema })
  .strict();
export type GetOrganizationSettingsInput = z.infer<typeof getOrganizationSettingsInputSchema>;

export const updateOrganizationSettingsInputSchema = z
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
export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsInputSchema>;

export const organizationSettingsSchema = z
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
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export const updateOrganizationSettingsResultSchema = z
  .object({ traceShareRevocationRequired: z.boolean() })
  .strict();
export type UpdateOrganizationSettingsResult = z.infer<
  typeof updateOrganizationSettingsResultSchema
>;

/**
 * Resolving the tenant behind one team. Answers `null` for a missing team,
 * and an ARCHIVED team's organization the same as a live one's — usage
 * metering and personal-workspace reads need a tenant regardless.
 */
export const getOrganizationIdByTeamIdInputSchema = z
  .object({ teamId: z.string().min(1) })
  .strict();
export type GetOrganizationIdByTeamIdInput = z.infer<typeof getOrganizationIdByTeamIdInputSchema>;

export const getOrganizationMembersInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    userIds: z.array(z.string().min(1)),
  })
  .strict();
export type GetOrganizationMembersInput = z.infer<typeof getOrganizationMembersInputSchema>;

export const getOldestTeamInputSchema = z.object({
  organizationId: organizationIdSchema,
});

export type GetOldestTeamInput = z.infer<typeof getOldestTeamInputSchema>;

export const getOrganizationBillingProfileInputSchema = z
  .object({ organizationId: organizationIdSchema })
  .strict();
export type GetOrganizationBillingProfileInput = z.infer<
  typeof getOrganizationBillingProfileInputSchema
>;

export const organizationBillingProfileSchema = z
  .object({
    id: organizationIdSchema,
    name: z.string(),
    billingCustomerId: z.string().min(1).nullable(),
  })
  .strict();
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
};

/**
 * How colleagues on a matching domain get into an organization; identity's join ledger
 * reads and writes it through OrganizationApi. Keep in step with
 * `modules/identity/contract/src/features/join-request/join-matching.ts`.
 */

export const organizationJoinSettingSchema = z
  .object({
    domainJoin: z.enum(["off", "request", "auto"]),
    joinDomains: z.array(z.string()),
    joinerRole: z.enum(["MEMBER", "DEVELOPER"]),
  })
  .strict();
export type OrganizationJoinSetting = z.infer<typeof organizationJoinSettingSchema>;

/** Where a join request was made (ADR-171 v6), written on a Developer admission's audit row. */
export const organizationJoinOriginSchema = z.enum(["web", "cli"]);
export type OrganizationJoinOrigin = z.infer<typeof organizationJoinOriginSchema>;

/**
 * The two sign-in security rules an organization sets, in the four columns it
 * owns: account lockout (GAC-09) and session limits (GAC-10).
 * specs/identity/org-account-lockout.feature, specs/identity/org-session-lifetime.feature
 */

export const signInSecurityPolicySchema = z.object({
  /** Consecutive failures before a lock. 0 = never lock. */
  lockoutAfterFailedAttempts: z.number().int().min(0).max(20),
  /** How long a lock lasts, in minutes. */
  lockoutMinutes: z.number().int().min(1).max(1440),
  /** Minutes a session may sit idle before it ends. 0 = no idle timeout. */
  sessionIdleTimeoutMinutes: z.number().int().min(0).max(10080),
  /** Minutes from sign-in after which a session ends regardless. 0 = no ceiling. */
  sessionMaxLifetimeMinutes: z.number().int().min(0).max(10080),
});
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
