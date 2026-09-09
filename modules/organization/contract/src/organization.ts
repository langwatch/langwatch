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
 * Resolving the tenant behind one team.
 *
 * Answers `null` for a team that does not exist, and answers an ARCHIVED
 * team's organization the same as a live one's: the callers are usage
 * metering and the personal-workspace reads, which have to place a project
 * under its tenant whether or not its team is still open for business.
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

export const claimOrganizationBillingCustomerInputSchema = z
  .object({
    organizationId: organizationIdSchema,
    billingCustomerId: z.string().min(1),
  })
  .strict();
export type ClaimOrganizationBillingCustomerInput = z.infer<
  typeof claimOrganizationBillingCustomerInputSchema
>;

/**
 * One audit-log row, with its actor and its project already resolved.
 *
 * DECLARED HERE RATHER THAN INFERRED FROM THE ROUTER because the screen that
 * renders it lives in `@langwatch/organization-web`, and a web package may
 * neither import `@langwatch/organization-server` nor name an `AppRouter` that
 * does not exist until a process instantiates one. `OrganizationApp.getAuditLogs`
 * is annotated with this type, so widening what the audit trail answers is a
 * compile error at the producer rather than a silent disclosure at the table.
 *
 * ONE TABLE, TWO SHAPES. Gateway writes carry `targetKind` plus a `before`/
 * `after` diff; platform writes carry `args` and `metadata`. `source` is
 * COMPUTED from the presence of `targetKind` rather than stored, which is why
 * it is not nullable while the four fields it is derived from are.
 *
 * `userId` is nullable so a background job, a migration or any other system
 * actor can write a row without inventing a person to blame it on.
 */
export type EnrichedAuditLog = {
  id: string;
  createdAt: Date;
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
