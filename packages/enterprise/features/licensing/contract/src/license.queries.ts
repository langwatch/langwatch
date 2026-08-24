import { z } from "zod/v4";

export const licenseOrganizationQuerySchema = z.object({
  organizationId: z.string().min(1),
});
export type LicenseOrganizationQuery = z.infer<
  typeof licenseOrganizationQuerySchema
>;
