/**
 * The wire shapes the custom-roles REST family publishes: no organization and
 * no kind, and writes bound to the permission cross product `GET /permissions`
 * publishes, so nothing a caller can read is ungrantable.
 */
import { ALL_PERMISSIONS, permissionResource } from "@langwatch/authorization";
import { bindingScopeCanGrantPermission } from "@langwatch/authz-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** Every resource the registry names, in registry order. */
export const ROLE_PERMISSION_RESOURCES: readonly string[] = [
  ...new Set([...ALL_PERMISSIONS.map((permission) => permissionResource(permission)), "scim"]),
];

/** Every action the registry names, sorted. */
export const ROLE_PERMISSION_ACTIONS: readonly string[] = [
  ...new Set(ALL_PERMISSIONS.map((permission) => permission.split(":")[1] ?? "")),
].toSorted();

const ROLE_PERMISSION_KEYS = new Set(
  ROLE_PERMISSION_RESOURCES.flatMap((resource) =>
    ROLE_PERMISSION_ACTIONS.map((action) => `${resource}:${action}`),
  ),
);

/** Whether a resource only takes effect at organization scope (ADR-021). */
export function roleResourceIsOrganizationExclusive(resource: string): boolean {
  const sample = ALL_PERMISSIONS.find((permission) => permissionResource(permission) === resource);

  return sample
    ? !bindingScopeCanGrantPermission({ scopeType: "PROJECT", permission: sample })
    : false;
}

export const rolePermissionKeySchema = z
  .string()
  .refine((value) => ROLE_PERMISSION_KEYS.has(value), {
    message: "must be a valid resource:action permission",
  });

const roleRestSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(z.string()),
  /** `admin`, `member` and `viewer`: always listed, never changed or deleted. */
  builtIn: z.boolean(),
  /** Null on a built-in role, which has no definition moment. */
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});
export interface RoleRestSchema extends Named<typeof roleRestSchemaDefinition> {}
export const roleRestSchema: RoleRestSchema = roleRestSchemaDefinition;
export type RoleRest = z.infer<typeof roleRestSchema>;

/** `?builtIn=true` lists only the built-in roles, `false` only the custom ones; omitted, both. */
const roleRestListQuerySchemaDefinition = z.object({
  builtIn: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
export interface RoleRestListQuerySchema extends Named<typeof roleRestListQuerySchemaDefinition> {}
export const roleRestListQuerySchema: RoleRestListQuerySchema = roleRestListQuerySchemaDefinition;

const roleRestListSchemaDefinition = z.object({ roles: z.array(roleRestSchema) });
export interface RoleRestListSchema extends Named<typeof roleRestListSchemaDefinition> {}
export const roleRestListSchema: RoleRestListSchema = roleRestListSchemaDefinition;

const roleRestParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface RoleRestParamsSchema extends Named<typeof roleRestParamsSchemaDefinition> {}
export const roleRestParamsSchema: RoleRestParamsSchema = roleRestParamsSchemaDefinition;

const roleRestCreateSchemaDefinition = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(rolePermissionKeySchema).min(1),
});
export interface RoleRestCreateSchema extends Named<typeof roleRestCreateSchemaDefinition> {}
export const roleRestCreateSchema: RoleRestCreateSchema = roleRestCreateSchemaDefinition;

const roleRestUpdateSchemaDefinition = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  /** Replaces the permission set outright. */
  permissions: z.array(rolePermissionKeySchema).min(1).optional(),
});
export interface RoleRestUpdateSchema extends Named<typeof roleRestUpdateSchemaDefinition> {}
export const roleRestUpdateSchema: RoleRestUpdateSchema = roleRestUpdateSchemaDefinition;

const roleRestDeletedSchemaDefinition = z.object({ success: z.literal(true) });
export interface RoleRestDeletedSchema extends Named<typeof roleRestDeletedSchemaDefinition> {}
export const roleRestDeletedSchema: RoleRestDeletedSchema = roleRestDeletedSchemaDefinition;

const rolePermissionCatalogSchemaDefinition = z.object({
  resources: z.array(
    z.object({
      resource: z.string(),
      /**
       * True when the resource only takes effect at organization scope, so a
       * custom role listing it cannot be bound at team or project scope.
       */
      organizationExclusive: z.boolean(),
      actions: z.array(z.string()),
      permissions: z.array(z.string()),
    }),
  ),
  actions: z.array(z.string()),
});
export interface RolePermissionCatalogSchema extends Named<
  typeof rolePermissionCatalogSchemaDefinition
> {}
export const rolePermissionCatalogSchema: RolePermissionCatalogSchema =
  rolePermissionCatalogSchemaDefinition;
export type RolePermissionCatalog = z.infer<typeof rolePermissionCatalogSchema>;
