/**
 * The access decision and the questions that ask for it. Authz answers them;
 * the framework and every module's declarations are typed in these shapes.
 */
import { z } from "zod";

import { authzPermissionSchema } from "./registry.ts";
import { declaredScopeIdSchema } from "./scope-tiers.ts";

export const organizationRoleSchema = z.enum(["ADMIN", "MEMBER", "EXTERNAL"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
export const OrganizationUserRole = organizationRoleSchema.enum;
export type OrganizationUserRole = OrganizationRole;

export const authzDenialReasonSchema = z.enum([
  "no-membership",
  "membership-disabled",
  "no-binding",
  "lite-member-restricted",
  "owner-ceiling",
]);
export type AuthzDenialReason = z.infer<typeof authzDenialReasonSchema>;

export const permissionDecisionSchema = z
  .object({
    permitted: z.boolean(),
    organizationRole: organizationRoleSchema.nullable(),
    denialReason: authzDenialReasonSchema.optional(),
  })
  .strict();
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;

export const authzGetDecisionInputSchema = z
  .object({
    userId: z.string(),
    permission: authzPermissionSchema,
    scope: declaredScopeIdSchema,
  })
  .strict();
export type AuthzGetDecisionInput = z.infer<typeof authzGetDecisionInputSchema>;

export const authzGetProjectAnyDecisionInputSchema = z
  .object({
    userId: z.string(),
    projectId: z.string(),
    permissions: z.array(authzPermissionSchema).readonly(),
  })
  .strict();
export type AuthzGetProjectAnyDecisionInput = z.infer<typeof authzGetProjectAnyDecisionInputSchema>;
