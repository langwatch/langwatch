/**
 * The inputs the `roleBinding.*` tRPC surface publishes.
 *
 * They live in the contract rather than beside the router so the wire shape a
 * client is typed against is stated once, in the package both sides may import.
 *
 * The role and scope vocabularies come from the authorization contract, which
 * owns them; restating either here would let a binding accept a tier the
 * decision engine cannot read.
 */
import { roleBindingScopeTypeSchema, teamUserRoleSchema } from "@langwatch/authz-contract";
import { z } from "zod";

/** One binding as the member editor submits it, before it has an id. */
export const roleBindingApiBindingWriteSchema = z.object({
  role: teamUserRoleSchema,
  customRoleId: z.string().optional(),
  scopeType: roleBindingScopeTypeSchema,
  scopeId: z.string(),
});

/** One organization, the tenant key every procedure on this surface takes. */
export const roleBindingApiOrganizationInputSchema = z.object({ organizationId: z.string() });

/** One member of one organization. */
export const roleBindingApiUserInputSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
});

/** One existing binding inside one organization. */
export const roleBindingApiBindingInputSchema = z.object({
  organizationId: z.string(),
  bindingId: z.string(),
});

export const roleBindingApiCreateInputSchema = z.object({
  organizationId: z.string(),
  // Principal — exactly one
  userId: z.string().optional(),
  groupId: z.string().optional(),
  // Role
  role: teamUserRoleSchema,
  customRoleId: z.string().optional(),
  // Scope
  scopeType: roleBindingScopeTypeSchema,
  scopeId: z.string(),
});

export const roleBindingApiUpdateInputSchema = z.object({
  organizationId: z.string(),
  bindingId: z.string(),
  role: teamUserRoleSchema,
  customRoleId: z.string().optional(),
});

export const roleBindingApiApplyMemberBindingsInputSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
  bindingIdsToDelete: z.array(z.string()),
  bindingsToCreate: z.array(roleBindingApiBindingWriteSchema),
});

export type RoleBindingApiBindingWrite = z.infer<typeof roleBindingApiBindingWriteSchema>;
export type RoleBindingApiOrganizationInput = z.infer<typeof roleBindingApiOrganizationInputSchema>;
export type RoleBindingApiUserInput = z.infer<typeof roleBindingApiUserInputSchema>;
export type RoleBindingApiBindingInput = z.infer<typeof roleBindingApiBindingInputSchema>;
export type RoleBindingApiCreateInput = z.infer<typeof roleBindingApiCreateInputSchema>;
export type RoleBindingApiUpdateInput = z.infer<typeof roleBindingApiUpdateInputSchema>;
export type RoleBindingApiApplyMemberBindingsInput = z.infer<
  typeof roleBindingApiApplyMemberBindingsInputSchema
>;
