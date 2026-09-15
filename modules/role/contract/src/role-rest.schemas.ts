/**
 * The wire shapes the custom-roles REST family publishes: no organization and
 * no kind, and writes bound to the permission cross product `GET /permissions`
 * publishes, so nothing a caller can read is ungrantable.
 */
import {
  ALL_PERMISSIONS,
  bindingScopeCanGrantPermission,
  permissionResource,
} from "@langwatch/authz-contract";
import { z } from "zod";

/** Every resource the registry names, in registry order. */
export const ROLE_PERMISSION_RESOURCES: readonly string[] = [
  ...new Set(ALL_PERMISSIONS.map((permission) => permissionResource(permission))),
];

/** Every action the registry names, sorted. */
export const ROLE_PERMISSION_ACTIONS: readonly string[] = [
  ...new Set(ALL_PERMISSIONS.map((permission) => permission.split(":")[1] ?? "")),
].sort();

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

export const roleRestSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type RoleRest = z.infer<typeof roleRestSchema>;

export const roleRestListSchema = z.object({ roles: z.array(roleRestSchema) });

export const roleRestParamsSchema = z.object({ id: z.string().min(1) });

export const roleRestCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(rolePermissionKeySchema).min(1),
});

export const roleRestUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  /** Replaces the permission set outright. */
  permissions: z.array(rolePermissionKeySchema).min(1).optional(),
});

export const roleRestDeletedSchema = z.object({ success: z.literal(true) });

export const rolePermissionCatalogSchema = z.object({
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
export type RolePermissionCatalog = z.infer<typeof rolePermissionCatalogSchema>;
