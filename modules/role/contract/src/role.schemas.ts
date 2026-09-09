/**
 * The inputs `role.*` publishes, stated once in the package both sides import.
 * Permissions parse against the authorization registry's own vocabulary, so a
 * role the decision engine could not read is refused here.
 */
import { authzPermissionSchema } from "@langwatch/authz-contract";
import { z } from "zod";

/** One organization, for the read that lists its custom roles. */
export const roleApiOrganizationInputSchema = z.object({ organizationId: z.string() });

/** One custom role, named on its own without a tenant key. */
export const roleApiRoleInputSchema = z.object({ roleId: z.string() });

/** Attaching or detaching one custom role for one member of one team. */
export const roleApiUserRoleAssignmentInputSchema = z.object({
  userId: z.string(),
  teamId: z.string(),
  customRoleId: z.string(),
});

/** Defining a custom role. */
export const roleApiCreateInputSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1).max(50),
  description: z.string().optional(),
  permissions: z.array(authzPermissionSchema),
});

/** Editing a custom role. */
export const roleApiUpdateInputSchema = z.object({
  roleId: z.string(),
  name: z.string().min(1).max(50).optional(),
  description: z.string().optional(),
  permissions: z.array(authzPermissionSchema).optional(),
});

export type RoleApiOrganizationInput = z.infer<typeof roleApiOrganizationInputSchema>;
export type RoleApiRoleInput = z.infer<typeof roleApiRoleInputSchema>;
export type RoleApiUserRoleAssignmentInput = z.infer<typeof roleApiUserRoleAssignmentInputSchema>;
export type RoleApiCreateInput = z.infer<typeof roleApiCreateInputSchema>;
export type RoleApiUpdateInput = z.infer<typeof roleApiUpdateInputSchema>;
