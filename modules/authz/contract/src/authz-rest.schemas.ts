import type { Named } from "@langwatch/module";
/**
 * The wire shapes of the `role-bindings` management REST family. A write's
 * answer is the row the list reports; only the create adds the
 * legacy-access notice, and only when it switches legacy team access off.
 */
import { z } from "zod";

import { grantScopeTierSchema, teamUserRoleSchema } from "./authz.ts";

const roleBindingPrincipalSchemaDefinition = z.object({
  type: z.enum(["user", "group", "apiKey"]),
  id: z.string(),
  name: z.string().nullable(),
});
export interface RoleBindingPrincipalSchema extends Named<
  typeof roleBindingPrincipalSchemaDefinition
> {}
export const roleBindingPrincipalSchema: RoleBindingPrincipalSchema =
  roleBindingPrincipalSchemaDefinition;
export type RoleBindingPrincipal = z.infer<typeof roleBindingPrincipalSchema>;

const roleBindingRestSchemaDefinition = z.object({
  id: z.string(),
  principal: roleBindingPrincipalSchema,
  role: teamUserRoleSchema,
  customRoleId: z.string().nullable(),
  customRoleName: z.string().nullable(),
  scopeType: grantScopeTierSchema,
  scopeId: z.string(),
  scopeName: z.string().nullable(),
  createdAt: z.date(),
  /** When this binding stops granting, or null when it never does; listed past its date too. */
  expiresAt: z.date().nullable(),
});
export interface RoleBindingRestSchema extends Named<typeof roleBindingRestSchemaDefinition> {}
export const roleBindingRestSchema: RoleBindingRestSchema = roleBindingRestSchemaDefinition;
export type RoleBindingRest = z.infer<typeof roleBindingRestSchema>;

const roleBindingRestListQuerySchemaDefinition = z.object({
  userId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  apiKeyId: z.string().min(1).optional(),
  scopeType: grantScopeTierSchema.optional(),
  scopeId: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export interface RoleBindingRestListQuerySchema extends Named<
  typeof roleBindingRestListQuerySchemaDefinition
> {}
export const roleBindingRestListQuerySchema: RoleBindingRestListQuerySchema =
  roleBindingRestListQuerySchemaDefinition;
export type RoleBindingRestListQuery = z.infer<typeof roleBindingRestListQuerySchema>;

const roleBindingRestListSchemaDefinition = z.object({
  bindings: z.array(roleBindingRestSchema),
  totalCount: z.number(),
});
export interface RoleBindingRestListSchema extends Named<
  typeof roleBindingRestListSchemaDefinition
> {}
export const roleBindingRestListSchema: RoleBindingRestListSchema =
  roleBindingRestListSchemaDefinition;
export type RoleBindingRestList = z.infer<typeof roleBindingRestListSchema>;

const roleBindingRestCreateSchemaDefinition = z.object({
  /** Exactly one of userId, groupId or apiKeyId; the service enforces it. */
  userId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  apiKeyId: z.string().min(1).optional(),
  role: teamUserRoleSchema,
  customRoleId: z.string().min(1).optional(),
  scopeType: grantScopeTierSchema,
  scopeId: z.string().min(1),
  /** Optional ISO-8601 end date, strictly in the future (`grant_expiry_in_past`, 422 otherwise). */
  expiresAt: z.coerce.date().optional(),
});
export interface RoleBindingRestCreateSchema extends Named<
  typeof roleBindingRestCreateSchemaDefinition
> {}
export const roleBindingRestCreateSchema: RoleBindingRestCreateSchema =
  roleBindingRestCreateSchemaDefinition;
export type RoleBindingRestCreate = z.infer<typeof roleBindingRestCreateSchema>;

const roleBindingRestUpdateSchemaDefinition = z.object({
  role: teamUserRoleSchema,
  customRoleId: z.string().min(1).optional(),
});
export interface RoleBindingRestUpdateSchema extends Named<
  typeof roleBindingRestUpdateSchemaDefinition
> {}
export const roleBindingRestUpdateSchema: RoleBindingRestUpdateSchema =
  roleBindingRestUpdateSchemaDefinition;
export type RoleBindingRestUpdate = z.infer<typeof roleBindingRestUpdateSchema>;

const roleBindingRestParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface RoleBindingRestParamsSchema extends Named<
  typeof roleBindingRestParamsSchemaDefinition
> {}
export const roleBindingRestParamsSchema: RoleBindingRestParamsSchema =
  roleBindingRestParamsSchemaDefinition;
export type RoleBindingRestParams = z.infer<typeof roleBindingRestParamsSchema>;

const roleBindingRestDeletedSchemaDefinition = z.object({ success: z.literal(true) });
export interface RoleBindingRestDeletedSchema extends Named<
  typeof roleBindingRestDeletedSchemaDefinition
> {}
export const roleBindingRestDeletedSchema: RoleBindingRestDeletedSchema =
  roleBindingRestDeletedSchemaDefinition;
export type RoleBindingRestDeleted = z.infer<typeof roleBindingRestDeletedSchema>;
