/**
 * The custom-roles management REST family.
 *
 * A role is addressed by id, but its name is the natural key provisioning
 * tools key on, so a taken name is a deterministic 409
 * (`custom_role_name_taken`) rather than a second role with the same name.
 * Every lookup is organization-scoped: a role id from another organization
 * reads as `custom_role_not_found`, never as someone else's role.
 *
 * `GET /permissions` publishes the catalog custom roles are built from: every
 * resource with its actions, annotated with whether the resource only takes
 * effect at organization scope (ADR-021) — the write-time refusal the role
 * bindings API enforces for those.
 */
import type { BaseApp, VersionBuilder } from "@langwatch/api";
import type { CustomRole, Organization } from "@prisma/client";
import type { Context } from "hono";
import { z } from "zod";
import { emitManagementAudit } from "~/server/api/management/audit";
import { createManagementService } from "~/server/api/management/managed-service";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import {
  Actions,
  isOrgExclusivePermission,
  type Permission,
  Resources,
} from "~/server/api/rbac";
import { prisma } from "~/server/db";
import { permissionFormatSchema } from "~/server/rbac/custom-role-permissions";
import { RoleService } from "~/server/role/role.service";

const { service, guard } = createManagementService({
  name: "roles",
  basePath: "/api/roles",
  feature: "RBAC",
});

type RolesFamilyApp = BaseApp & { roles: RoleService };
type RolesVersion = VersionBuilder<RolesFamilyApp>;

// ── wire schemas ─────────────────────────────────────────────────────────────

const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(permissionFormatSchema).min(1),
});

const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  /** Replaces the permission set outright. */
  permissions: z.array(permissionFormatSchema).min(1).optional(),
});

const permissionCatalogSchema = z.object({
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

const idParamsSchema = z.object({ id: z.string().min(1) });

const roleWire = (
  role: Pick<
    CustomRole,
    "id" | "name" | "description" | "createdAt" | "updatedAt"
  > & { permissions: string[] },
): z.infer<typeof roleSchema> => ({
  id: role.id,
  name: role.name,
  description: role.description,
  permissions: role.permissions,
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
});

const organizationOf = (c: Context): Organization =>
  c.get("organization") as Organization;

// ── handlers ─────────────────────────────────────────────────────────────────

const listRolesHandler = async (
  c: Context,
  { app }: { app: RolesFamilyApp },
) => {
  const roles = await app.roles.getAllRoles(organizationOf(c).id);
  return { roles: roles.map(roleWire) };
};

const createRoleHandler = async (
  c: Context,
  {
    input,
    app,
  }: { input: z.infer<typeof createRoleSchema>; app: RolesFamilyApp },
) => {
  const organization = organizationOf(c);
  const role = await app.roles.createRole({
    organizationId: organization.id,
    name: input.name,
    description: input.description ?? null,
    permissions: input.permissions,
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.role.create",
    args: { roleId: role.id, name: role.name },
  });
  return roleWire(role);
};

const permissionCatalogHandler = async () => {
  const actions = Object.values(Actions) as string[];
  return {
    resources: (Object.values(Resources) as string[]).map((resource) => ({
      resource,
      organizationExclusive: isOrgExclusivePermission(
        `${resource}:view` as Permission,
      ),
      actions,
      permissions: actions.map((action) => `${resource}:${action}`),
    })),
    actions,
  };
};

const getRoleHandler = async (
  c: Context,
  {
    params,
    app,
  }: { params: z.infer<typeof idParamsSchema>; app: RolesFamilyApp },
) => {
  const role = await app.roles.getRoleForOrg({
    roleId: params.id,
    organizationId: organizationOf(c).id,
  });
  return roleWire(role);
};

const updateRoleHandler = async (
  c: Context,
  {
    params,
    input,
    app,
  }: {
    params: z.infer<typeof idParamsSchema>;
    input: z.infer<typeof updateRoleSchema>;
    app: RolesFamilyApp;
  },
) => {
  const organization = organizationOf(c);
  const role = await app.roles.updateRoleForOrg({
    roleId: params.id,
    organizationId: organization.id,
    params: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.permissions !== undefined
        ? { permissions: input.permissions }
        : {}),
    },
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.role.update",
    args: { roleId: params.id, fields: Object.keys(input) },
  });
  return roleWire(role);
};

const deleteRoleHandler = async (
  c: Context,
  {
    params,
    app,
  }: { params: z.infer<typeof idParamsSchema>; app: RolesFamilyApp },
) => {
  const organization = organizationOf(c);
  await app.roles.deleteRoleForOrg({
    roleId: params.id,
    organizationId: organization.id,
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.role.delete",
    args: { roleId: params.id },
  });
  return { success: true as const };
};

// ── endpoint registration ────────────────────────────────────────────────────

const registerCollectionEndpoints = (v: RolesVersion): void => {
  v.get(
    "/",
    {
      ...guard("organization:manage"),
      output: z.object({ roles: z.array(roleSchema) }),
      description:
        "List the organization's custom roles with their permission sets.",
      docs: { operationId: "listRoles", tags: ["Roles"] },
    },
    listRolesHandler,
  );

  v.post(
    "/",
    {
      ...guard("organization:manage"),
      input: createRoleSchema,
      output: roleSchema,
      status: 201,
      description:
        "Create a custom role from resource:action permission keys. The name is unique within the organization; a taken name answers 409 custom_role_name_taken.",
      docs: { operationId: "createRole", tags: ["Roles"] },
    },
    createRoleHandler,
  );

  // Declared before /:id so the static segment can never be read as an id.
  v.get(
    "/permissions",
    {
      ...guard("organization:manage"),
      output: permissionCatalogSchema,
      description:
        "The permission catalog custom roles are built from: every resource with its actions, annotated with whether the resource only takes effect at organization scope (such a permission cannot be granted by a team- or project-scoped binding).",
      docs: { operationId: "listRolePermissions", tags: ["Roles"] },
    },
    permissionCatalogHandler,
  );
};

const registerItemEndpoints = (v: RolesVersion): void => {
  v.get(
    "/:id",
    {
      ...guard("organization:manage"),
      params: idParamsSchema,
      output: roleSchema,
      description:
        "Read one custom role. An id from another organization answers 404 custom_role_not_found.",
      docs: { operationId: "getRole", tags: ["Roles"] },
    },
    getRoleHandler,
  );

  v.patch(
    "/:id",
    {
      ...guard("organization:manage"),
      params: idParamsSchema,
      input: updateRoleSchema,
      output: roleSchema,
      description:
        "Update a custom role. Partial: only the fields present are written; a permissions list replaces the set outright.",
      docs: { operationId: "updateRole", tags: ["Roles"] },
    },
    updateRoleHandler,
  );

  v.delete(
    "/:id",
    {
      ...guard("organization:manage"),
      params: idParamsSchema,
      output: z.object({ success: z.literal(true) }),
      description:
        "Delete a custom role. A role that anything still holds — a legacy team assignment or a role binding — answers 409 custom_role_in_use with the counts in meta.",
      docs: { operationId: "deleteRole", tags: ["Roles"] },
    },
    deleteRoleHandler,
  );
};

// ── service wiring ───────────────────────────────────────────────────────────

export const app = service
  .provide({
    roles: () => new RoleService(prisma),
  })
  .version(MANAGEMENT_API_VERSION, (v) => {
    registerCollectionEndpoints(v);
    registerItemEndpoints(v);
  })
  .build();
