/**
 * The wire shapes the `/api/organizations` REST family publishes: instance
 * administrator provisioning, self-hosted only.
 */
import { z } from "zod";

export const organizationsProvisioningRestCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase letters, numbers and single hyphens")
    .optional(),
  adminApiKeyName: z.string().trim().min(1).max(100).optional(),
});

export const organizationsProvisioningRestParamsSchema = z.object({ id: z.string().min(1) });

/** One organization, as every route here reports it. */
export const organizationsProvisioningRestSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  createdAt: z.date(),
});

export const organizationsProvisioningRestCreatedSchema = z.object({
  organization: z.object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string(),
  }),
  // The team the provisioning port built alongside it, passed through in the
  // shape that port returns rather than restated here.
  team: z.unknown(),
  adminApiKey: z.object({ id: z.string().min(1), token: z.string().min(1) }),
});

export const organizationsProvisioningRestListSchema = z.object({
  organizations: z.array(organizationsProvisioningRestSummarySchema),
});

export const organizationsProvisioningRestGotOneSchema = z.object({
  organization: organizationsProvisioningRestSummarySchema,
});
