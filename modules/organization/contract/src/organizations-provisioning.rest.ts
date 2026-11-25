import type { Named } from "@langwatch/module";
/**
 * The wire shapes organization's `/api/organizations` reads publish, self-hosted
 * only; api-key's contract holds the provisioning POST's shapes (R3).
 */
import { z } from "zod";

const organizationsProvisioningRestParamsSchemaDefinition = z.object({
  organizationId: z.string().min(1),
});
export interface OrganizationsProvisioningRestParamsSchema extends Named<
  typeof organizationsProvisioningRestParamsSchemaDefinition
> {}
export const organizationsProvisioningRestParamsSchema: OrganizationsProvisioningRestParamsSchema =
  organizationsProvisioningRestParamsSchemaDefinition;

/** One organization, as every route here reports it. */
const organizationsProvisioningRestSummarySchemaDefinition = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  createdAt: z.date(),
});
export interface OrganizationsProvisioningRestSummarySchema extends Named<
  typeof organizationsProvisioningRestSummarySchemaDefinition
> {}
export const organizationsProvisioningRestSummarySchema: OrganizationsProvisioningRestSummarySchema =
  organizationsProvisioningRestSummarySchemaDefinition;

const organizationsProvisioningRestListSchemaDefinition = z.object({
  organizations: z.array(organizationsProvisioningRestSummarySchema),
});
export interface OrganizationsProvisioningRestListSchema extends Named<
  typeof organizationsProvisioningRestListSchemaDefinition
> {}
export const organizationsProvisioningRestListSchema: OrganizationsProvisioningRestListSchema =
  organizationsProvisioningRestListSchemaDefinition;

const organizationsProvisioningRestGotOneSchemaDefinition = z.object({
  organization: organizationsProvisioningRestSummarySchema,
});
export interface OrganizationsProvisioningRestGotOneSchema extends Named<
  typeof organizationsProvisioningRestGotOneSchemaDefinition
> {}
export const organizationsProvisioningRestGotOneSchema: OrganizationsProvisioningRestGotOneSchema =
  organizationsProvisioningRestGotOneSchemaDefinition;
