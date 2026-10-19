/**
 * The inputs `role.*` publishes, stated once in the package both sides import.
 * Permissions parse against the authorization registry's own vocabulary, so a
 * role the decision engine could not read is refused here.
 */
import { authzPermissionSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** One organization, for the read that lists its custom roles. */
const roleApiOrganizationInputSchemaDefinition = z.object({ organizationId: z.string() });
export interface RoleApiOrganizationInputSchema extends Named<
  typeof roleApiOrganizationInputSchemaDefinition
> {}
export const roleApiOrganizationInputSchema: RoleApiOrganizationInputSchema =
  roleApiOrganizationInputSchemaDefinition;

/** One custom role, named on its own without a tenant key. */
const roleApiRoleInputSchemaDefinition = z.object({ roleId: z.string() });
export interface RoleApiRoleInputSchema extends Named<typeof roleApiRoleInputSchemaDefinition> {}
export const roleApiRoleInputSchema: RoleApiRoleInputSchema = roleApiRoleInputSchemaDefinition;

/** Attaching or detaching one custom role for one member of one team. */
const roleApiUserRoleAssignmentInputSchemaDefinition = z.object({
  userId: z.string(),
  teamId: z.string(),
  customRoleId: z.string(),
});
export interface RoleApiUserRoleAssignmentInputSchema extends Named<
  typeof roleApiUserRoleAssignmentInputSchemaDefinition
> {}
export const roleApiUserRoleAssignmentInputSchema: RoleApiUserRoleAssignmentInputSchema =
  roleApiUserRoleAssignmentInputSchemaDefinition;

/** Defining a custom role. */
const roleApiCreateInputSchemaDefinition = z.object({
  organizationId: z.string(),
  name: z.string().min(1).max(50),
  description: z.string().optional(),
  permissions: z.array(authzPermissionSchema),
});
export interface RoleApiCreateInputSchema extends Named<
  typeof roleApiCreateInputSchemaDefinition
> {}
export const roleApiCreateInputSchema: RoleApiCreateInputSchema =
  roleApiCreateInputSchemaDefinition;

/** Editing a custom role. */
const roleApiUpdateInputSchemaDefinition = z.object({
  roleId: z.string(),
  name: z.string().min(1).max(50).optional(),
  description: z.string().optional(),
  permissions: z.array(authzPermissionSchema).optional(),
});
export interface RoleApiUpdateInputSchema extends Named<
  typeof roleApiUpdateInputSchemaDefinition
> {}
export const roleApiUpdateInputSchema: RoleApiUpdateInputSchema =
  roleApiUpdateInputSchemaDefinition;

export type RoleApiOrganizationInput = z.infer<typeof roleApiOrganizationInputSchema>;
export type RoleApiRoleInput = z.infer<typeof roleApiRoleInputSchema>;
export type RoleApiUserRoleAssignmentInput = z.infer<typeof roleApiUserRoleAssignmentInputSchema>;
export type RoleApiCreateInput = z.infer<typeof roleApiCreateInputSchema>;
export type RoleApiUpdateInput = z.infer<typeof roleApiUpdateInputSchema>;
