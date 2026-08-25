import { z } from "zod";

export const organizationIdSchema = z.string().min(1);

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
