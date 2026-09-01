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
