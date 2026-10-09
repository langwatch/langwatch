/**
 * The wire shapes organization's `/api/organizations` reads publish, self-hosted
 * only; api-key's contract holds the provisioning POST's shapes (R3).
 */
import { z } from "zod";

export const organizationsProvisioningRestParamsSchema = z.object({
  organizationId: z.string().min(1),
});

/** One organization, as every route here reports it. */
export const organizationsProvisioningRestSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  createdAt: z.date(),
});

export const organizationsProvisioningRestListSchema = z.object({
  organizations: z.array(organizationsProvisioningRestSummarySchema),
});

export const organizationsProvisioningRestGotOneSchema = z.object({
  organization: organizationsProvisioningRestSummarySchema,
});
