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
 * effect at organization scope (ADR-021): the write-time refusal the role
 * bindings API enforces for those.
 *
 * Every write here is a grants-ledger command (ADR-092 §13), so the audit
 * trail is the pipeline's insert-only subscriber (decision 17): these
 * handlers never emit `management.role.*` rows of their own — that would
 * record the same mutation twice.
 */
import type { EndpointVariables, ServiceContext } from "@langwatch/api";
import type { Context } from "hono";
import type { Role } from "@langwatch/role-contract";
import { z } from "zod";
import { orgRequestLedgerActor } from "~/app/api/shared/ledger-actor";
import type { Organization } from "~/generated/prisma/client";
import { createManagementService } from "~/server/api/management/managed-service";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { isOrgExclusivePermission, type Permission } from "~/server/api/rbac";
import { permissionFormatSchema } from "~/server/rbac/custom-role-permissions";
import { Actions, Resources } from "~/utils/rbacVocabulary";

const { service, guard } = createManagementService({
  name: "roles",
  basePath: "/api/roles",
  feature: "RBAC",
});

/** The handler context: the framework's variables plus the family's provider. */
type RolesContext = ServiceContext<EndpointVariables>;

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
  role: Pick<Role, "id" | "name" | "description" | "createdAt" | "updatedAt"> & {
    permissions: string[];
  },
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

/** Validated path params, typed at the read site (see the chain note in @langwatch/api). */
const paramsOf = <T>(c: RolesContext): T => c.get("params") as T;

// ── handlers ─────────────────────────────────────────────────────────────────

const listRolesHandler = async (c: RolesContext) => {
  const roles = await c.var.langwatchApp.roles.list({
    organizationId: organizationOf(c).id,
  });
  return { roles: roles.map(roleWire) };
};

const createRoleHandler = async (
  c: RolesContext,
  input: z.infer<typeof createRoleSchema>,
) => {
  const organization = organizationOf(c);
  const role = await c.var.langwatchApp.roles.create({
    role: {
      organizationId: organization.id,
      name: input.name,
      description: input.description ?? null,
      permissions: input.permissions,
    },
    actor: orgRequestLedgerActor(c),
  });
  return roleWire(role);
};

const permissionCatalogHandler = async () => {
  const actions = Object.values(Actions) as string[];
  return {
    resources: (Object.values(Resources) as string[]).map((resource) => ({
      resource,
      organizationExclusive: isOrgExclusivePermission(`${resource}:view` as Permission),
      actions,
      permissions: actions.map((action) => `${resource}:${action}`),
    })),
    actions,
  };
};

const getRoleHandler = async (c: RolesContext) => {
  const params = paramsOf<z.infer<typeof idParamsSchema>>(c);
  const role = await c.var.langwatchApp.roles.getForOrganization({
    roleId: params.id,
    organizationId: organizationOf(c).id,
  });
  return roleWire(role);
};

const updateRoleHandler = async (
  c: RolesContext,
  input: z.infer<typeof updateRoleSchema>,
) => {
  const params = paramsOf<z.infer<typeof idParamsSchema>>(c);
  const organization = organizationOf(c);
  const role = await c.var.langwatchApp.roles.updateForOrganization({
    roleId: params.id,
    organizationId: organization.id,
    changes: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
    },
    actor: orgRequestLedgerActor(c),
  });
  return roleWire(role);
};

const deleteRoleHandler = async (c: RolesContext) => {
  const params = paramsOf<z.infer<typeof idParamsSchema>>(c);
  const organization = organizationOf(c);
  await c.var.langwatchApp.roles.removeForOrganization({
    roleId: params.id,
    organizationId: organization.id,
    actor: orgRequestLedgerActor(c),
  });
  return { success: true as const };
};

// ── service wiring ───────────────────────────────────────────────────────────

export const app = service
  .registerRoute("get", "/", MANAGEMENT_API_VERSION, listRolesHandler, (b) =>
    guard("organization:manage")(b)
      .withOutput(z.object({ roles: z.array(roleSchema) }))
      .withDocs({
        operationId: "listRoles",
        tags: ["Roles"],
        description: "List the organization's custom roles with their permission sets.",
      }),
  )
  .registerRoute("post", "/", MANAGEMENT_API_VERSION, createRoleHandler, (b) =>
    guard("organization:manage")(b)
      .withInput(createRoleSchema)
      .withOutput(roleSchema)
      .withStatus(201)
      .withDocs({
        operationId: "createRole",
        tags: ["Roles"],
        description:
          "Create a custom role from resource:action permission keys. The name is unique within the organization; a taken name answers 409 custom_role_name_taken.",
      }),
  )
  // Declared before /:id so the static segment can never be read as an id.
  .registerRoute(
    "get",
    "/permissions",
    MANAGEMENT_API_VERSION,
    permissionCatalogHandler,
    (b) =>
      guard("organization:manage")(b)
        .withOutput(permissionCatalogSchema)
        .withDocs({
          operationId: "listRolePermissions",
          tags: ["Roles"],
          description:
            "The permission catalog custom roles are built from: every resource with its actions, annotated with whether the resource only takes effect at organization scope (such a permission cannot be granted by a team- or project-scoped binding).",
        }),
  )
  .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getRoleHandler, (b) =>
    guard("organization:manage")(b)
      .withParams(idParamsSchema)
      .withOutput(roleSchema)
      .withDocs({
        operationId: "getRole",
        tags: ["Roles"],
        description:
          "Read one custom role. An id from another organization answers 404 custom_role_not_found.",
      }),
  )
  .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, updateRoleHandler, (b) =>
    guard("organization:manage")(b)
      .withParams(idParamsSchema)
      .withInput(updateRoleSchema)
      .withOutput(roleSchema)
      .withDocs({
        operationId: "updateRole",
        tags: ["Roles"],
        description:
          "Update a custom role. Partial: only the fields present are written; a permissions list replaces the set outright.",
      }),
  )
  .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, deleteRoleHandler, (b) =>
    guard("organization:manage")(b)
      .withParams(idParamsSchema)
      .withOutput(z.object({ success: z.literal(true) }))
      .withDocs({
        operationId: "deleteRole",
        tags: ["Roles"],
        description:
          "Delete a custom role. A role that anything still holds, a legacy team assignment or a role binding, answers 409 custom_role_in_use with the counts in meta.",
      }),
  )
  .build();
