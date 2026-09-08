/**
 * The wire shapes of the `role-bindings` management REST family.
 *
 * A write's answer is the row the list reports, so the create and update
 * outputs are the same binding shape a read carries; only the create adds the
 * legacy-access notice, and only when this write switches legacy team access
 * off for that user.
 */
import { z } from "zod";
import { roleBindingScopeTypeSchema, teamUserRoleSchema } from "./authz.ts";

export const roleBindingPrincipalSchema = z.object({
  type: z.enum(["user", "group", "apiKey"]),
  id: z.string(),
  name: z.string().nullable(),
});
export type RoleBindingPrincipal = z.infer<typeof roleBindingPrincipalSchema>;

export const roleBindingRestSchema = z.object({
  id: z.string(),
  principal: roleBindingPrincipalSchema,
  role: teamUserRoleSchema,
  customRoleId: z.string().nullable(),
  customRoleName: z.string().nullable(),
  scopeType: roleBindingScopeTypeSchema,
  scopeId: z.string(),
  scopeName: z.string().nullable(),
  createdAt: z.date(),
});
export type RoleBindingRest = z.infer<typeof roleBindingRestSchema>;

export const roleBindingRestCreatedSchema = roleBindingRestSchema.extend({
  /**
   * Present (true) only when this is the user's first explicit binding and
   * their access so far derived from legacy team membership, which this
   * write switches off. Informative, never blocking.
   */
  hasLegacyAccessNotice: z.boolean().optional(),
});
export type RoleBindingRestCreated = z.infer<typeof roleBindingRestCreatedSchema>;

export const roleBindingRestListQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  apiKeyId: z.string().min(1).optional(),
  scopeType: roleBindingScopeTypeSchema.optional(),
  scopeId: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type RoleBindingRestListQuery = z.infer<typeof roleBindingRestListQuerySchema>;

export const roleBindingRestListSchema = z.object({
  bindings: z.array(roleBindingRestSchema),
  totalCount: z.number(),
});
export type RoleBindingRestList = z.infer<typeof roleBindingRestListSchema>;

export const roleBindingRestCreateSchema = z.object({
  /** Exactly one of userId, groupId or apiKeyId; the service enforces it. */
  userId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  apiKeyId: z.string().min(1).optional(),
  role: teamUserRoleSchema,
  customRoleId: z.string().min(1).optional(),
  scopeType: roleBindingScopeTypeSchema,
  scopeId: z.string().min(1),
});
export type RoleBindingRestCreate = z.infer<typeof roleBindingRestCreateSchema>;

export const roleBindingRestUpdateSchema = z.object({
  role: teamUserRoleSchema,
  customRoleId: z.string().min(1).optional(),
});
export type RoleBindingRestUpdate = z.infer<typeof roleBindingRestUpdateSchema>;

export const roleBindingRestParamsSchema = z.object({ id: z.string().min(1) });
export type RoleBindingRestParams = z.infer<typeof roleBindingRestParamsSchema>;

export const roleBindingRestDeletedSchema = z.object({ success: z.literal(true) });
export type RoleBindingRestDeleted = z.infer<typeof roleBindingRestDeletedSchema>;
