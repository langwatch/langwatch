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
import type { EndpointVariables, ServiceContext } from "@langwatch/api/rest";
import type { OrganizationLedgerActor } from "@langwatch/organization-contract";
import type { Organization } from "@langwatch/prisma-client/generated";
import type { Role, RoleService } from "@langwatch/role-contract";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  type AppRestRbacVocabulary,
  type AppRestSecurity,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
} from "../../app-rest";

/** The handler context: the framework's variables plus the family's provider. */
type RolesContext = ServiceContext<EndpointVariables & { roles: RoleService }>;

// ── wire schemas ─────────────────────────────────────────────────────────────

const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
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

const organizationOf = (c: Context): Organization => c.get("organization") as Organization;

/**
 * REST for the organization's custom roles.
 *
 * The role capability arrives as a provider and the permission vocabulary as a
 * port, so this family can be mounted into any process that has both.
 */
export function createRolesRestApp(options: {
  security: AppRestSecurity;
  /**
   * The Enterprise plan gate for this family's capability, applied after
   * authentication and after the RBAC check on every route it declares.
   *
   * A plain middleware the mount supplies, not a feature of the builder: the
   * REST service neither knows nor names Enterprise, and "you don't have
   * access" still beats "your plan doesn't include this".
   */
  enterpriseGate: MiddlewareHandler;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  roles: () => RoleService;
  vocabulary: AppRestRbacVocabulary;
  /** Who a REST write is attributed to in the grants ledger (ADR-092). */
  ledgerActor: (c: Context<any>) => OrganizationLedgerActor;
}): MountableRestApp {
  const { security, enterpriseGate, roles, vocabulary, ledgerActor } = options;

  const { service, policy } = security.createVersionedApp({
    name: "roles",
    basePath: "/api/roles",
    routeMiddleware: [enterpriseGate],
  });

  /**
   * The same `resource:action` set the custom-role validator accepts, derived
   * from the process's vocabulary rather than restated: the catalog `GET
   * /permissions` publishes and the strings a write may name have to be the
   * same list, or a caller can read a permission it cannot then grant.
   */
  const validPermissions = new Set(
    vocabulary.resources.flatMap((resource) =>
      vocabulary.actions.map((action) => `${resource}:${action}`),
    ),
  );

  const permissionFormatSchema = z.string().refine((val) => validPermissions.has(val), {
    message: "must be a valid resource:action permission",
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

  // ── handlers ───────────────────────────────────────────────────────────────

  const listRolesHandler = async (c: RolesContext) => {
    const found = await c.get("roles").list({
      organizationId: organizationOf(c).id,
    });
    return { roles: found.map(roleWire) };
  };

  const createRoleHandler = async (c: RolesContext, input: z.infer<typeof createRoleSchema>) => {
    const organization = organizationOf(c);
    const role = await c.get("roles").create({
      role: {
        organizationId: organization.id,
        name: input.name,
        description: input.description ?? null,
        permissions: input.permissions,
      },
      actor: ledgerActor(c),
    });
    return roleWire(role);
  };

  const permissionCatalogHandler = async () => {
    const actions = [...vocabulary.actions];
    return {
      resources: vocabulary.resources.map((resource) => ({
        resource,
        organizationExclusive: vocabulary.isOrganizationExclusive(resource),
        actions,
        permissions: actions.map((action) => `${resource}:${action}`),
      })),
      actions,
    };
  };

  const getRoleHandler = async (c: RolesContext, input: z.infer<typeof idParamsSchema>) => {
    const role = await c.get("roles").getForOrganization({
      roleId: input.id,
      organizationId: organizationOf(c).id,
    });
    return roleWire(role);
  };

  const updateRoleHandler = async (
    c: RolesContext,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof updateRoleSchema>,
  ) => {
    const organization = organizationOf(c);
    const role = await c.get("roles").updateForOrganization({
      roleId: input.id,
      organizationId: organization.id,
      changes: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
      },
      actor: ledgerActor(c),
    });
    return roleWire(role);
  };

  const deleteRoleHandler = async (c: RolesContext, input: z.infer<typeof idParamsSchema>) => {
    const organization = organizationOf(c);
    await c.get("roles").removeForOrganization({
      roleId: input.id,
      organizationId: organization.id,
      actor: ledgerActor(c),
    });
    return { success: true as const };
  };

  // ── service wiring ─────────────────────────────────────────────────────────

  return (
    service
      .provide({ roles: () => roles() })
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listRolesHandler, (b) =>
        policy("organization:manage")(b)
          .withOutput(z.object({ roles: z.array(roleSchema) }))
          .withDocs({
            operationId: "listRoles",
            tags: ["Roles"],
            description: "List the organization's custom roles with their permission sets.",
          }),
      )
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createRoleHandler, (b) =>
        policy("organization:manage")(b)
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
      .registerRoute("get", "/permissions", MANAGEMENT_API_VERSION, permissionCatalogHandler, (b) =>
        policy("organization:manage")(b)
          .withOutput(permissionCatalogSchema)
          .withDocs({
            operationId: "listRolePermissions",
            tags: ["Roles"],
            description:
              "The permission catalog custom roles are built from: every resource with its actions, annotated with whether the resource only takes effect at organization scope (such a permission cannot be granted by a team- or project-scoped binding).",
          }),
      )
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getRoleHandler, (b) =>
        policy("organization:manage")(b)
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
        policy("organization:manage")(b)
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
        policy("organization:manage")(b)
          .withParams(idParamsSchema)
          .withOutput(z.object({ success: z.literal(true) }))
          .withDocs({
            operationId: "deleteRole",
            tags: ["Roles"],
            description:
              "Delete a custom role. A role that anything still holds, a legacy team assignment or a role binding, answers 409 custom_role_in_use with the counts in meta.",
          }),
      )
      .build()
  );
}
