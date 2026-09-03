/**
 * The inputs the `role.*` tRPC surface publishes.
 *
 * They live in the contract rather than beside the router so the wire shape a
 * client is typed against is stated once, in the package both sides may import.
 *
 * The two write schemas are factories: the permission vocabulary a custom role
 * is written in spans every feature, so the process owns it and hands it in.
 * This surface only says that a permission is a validated string.
 */
import { z } from "zod";

/**
 * The permission vocabulary a custom role is written in. It spans every
 * feature, so the process owns it and hands it in — the role surface only
 * says that a permission is a validated string.
 */
export type CustomRolePermissionSchema = z.ZodType<string, string>;

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

/** Defining a custom role. `customRolePermission` is the process's vocabulary. */
export function roleApiCreateInputSchema(customRolePermission: CustomRolePermissionSchema) {
  return z.object({
    organizationId: z.string(),
    name: z.string().min(1).max(50),
    description: z.string().optional(),
    permissions: z.array(customRolePermission),
  });
}

/** Editing a custom role. `customRolePermission` is the process's vocabulary. */
export function roleApiUpdateInputSchema(customRolePermission: CustomRolePermissionSchema) {
  return z.object({
    roleId: z.string(),
    name: z.string().min(1).max(50).optional(),
    description: z.string().optional(),
    permissions: z.array(customRolePermission).optional(),
  });
}

export type RoleApiOrganizationInput = z.infer<typeof roleApiOrganizationInputSchema>;
export type RoleApiRoleInput = z.infer<typeof roleApiRoleInputSchema>;
export type RoleApiUserRoleAssignmentInput = z.infer<typeof roleApiUserRoleAssignmentInputSchema>;
