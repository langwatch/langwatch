/**
 * The custom-roles management REST family. Every write is a grants-ledger
 * command (ADR-092 §13), so no handler emits an audit row of its own, and the
 * organization arrives as a bound fact rather than off a project scope.
 */
import type { Actor } from "@langwatch/actor";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import {
  ROLE_KIND,
  RoleApi,
  rolePermissionCatalogSchema,
  roleRestCreateSchema,
  roleRestDeletedSchema,
  roleRestListQuerySchema,
  roleRestListSchema,
  roleRestParamsSchema,
  roleRestSchema,
  roleRestUpdateSchema,
  type Role,
  type RoleCaller,
  type RoleRest,
} from "@langwatch/role-contract";
import { z } from "zod";

/**
 * Who a write is attributed to: the person the key acts as, or the management
 * credential itself, which the grants ledger records as a system actor.
 */
const callerOf = (actor: Actor | null, apiKeyId: string): RoleCaller => ({
  id: actor && "id" in actor ? actor.id : null,
  apiKeyId,
});

/** The organization the credential resolved, and the key whose permissions bound a write. */
export const roleRestFacts = defineRestMiddleware(
  "roleRestFacts",
  z.object({ organizationId: z.string(), apiKeyId: z.string() }),
);

const wire = (role: Role): RoleRest => ({
  id: role.id,
  name: role.name,
  description: role.description,
  permissions: role.permissions,
  builtIn: role.kind === ROLE_KIND.BUILT_IN,
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
});

export const roleRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<RoleApi>;
}> = defineRestRouter(RoleApi)
  .withNamespace("roles")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")

  .get("/", "listRoles")
  .withQuery(roleRestListQuerySchema)
  .withPermission("organization:manage")
  .withOutput(roleRestListSchema)
  .withDocs({
    tags: ["Roles"],
    description:
      "List the organization's roles with their permission sets: the built-in roles `admin`, `member` and `viewer` first (marked `builtIn`), then the custom roles. `?builtIn=true` lists only the built-in roles, `?builtIn=false` only the custom ones.",
  })
  .withMiddleware(roleRestFacts)
  .handle(async ({ app, input }, organization) => {
    const roles = await app.listRoles({
      organizationId: organization.organizationId,
      ...(input.builtIn === undefined ? {} : { builtIn: input.builtIn }),
    });

    return { roles: roles.map(wire) };
  })

  .post("/", "createRole")
  .withInput(roleRestCreateSchema)
  .withPermission("organization:manage")
  .withOutput(roleRestSchema)
  .withStatus(201)
  .withDocs({
    tags: ["Roles"],
    description:
      "Create a custom role from resource:action permission keys. The name is unique within the organization; a taken name answers 409 custom_role_name_taken.",
  })
  .withMiddleware(roleRestFacts)
  .handle(async ({ app, input, actor }, organization) =>
    wire(
      await app.createRole(
        {
          role: {
            organizationId: organization.organizationId,
            name: input.name,
            description: input.description ?? null,
            permissions: input.permissions,
          },
        },
        callerOf(actor, organization.apiKeyId),
      ),
    ),
  )

  // Declared before /:id so the static segment can never be read as an id.
  .get("/permissions", "listRolePermissions")
  .withPermission("organization:manage")
  .withOutput(rolePermissionCatalogSchema)
  .withDocs({
    tags: ["Roles"],
    description:
      "The permission catalog custom roles are built from: every resource with its actions, annotated with whether the resource only takes effect at organization scope (such a permission cannot be granted by a team- or project-scoped binding).",
  })
  .handle(async ({ app }) => app.getPermissionCatalog())

  .get("/:id", "getRole")
  .withParams(roleRestParamsSchema)
  .withPermission("organization:manage")
  .withOutput(roleRestSchema)
  .withDocs({
    tags: ["Roles"],
    description:
      "Read one role: `admin`, `member` or `viewer`, or a custom role's id. A custom id from another organization answers 404 custom_role_not_found.",
  })
  .withMiddleware(roleRestFacts)
  .handle(async ({ app, input }, organization) =>
    wire(
      await app.getRoleInOrganization({
        roleId: input.id,
        organizationId: organization.organizationId,
      }),
    ),
  )

  .patch("/:id", "updateRole")
  .withParams(roleRestParamsSchema)
  .withInput(roleRestUpdateSchema)
  .withPermission("organization:manage")
  .withOutput(roleRestSchema)
  .withDocs({
    tags: ["Roles"],
    description:
      "Update a custom role. Partial: only the fields present are written; a permissions list replaces the set outright. A built-in role answers 409 role_is_built_in; adding a permission the caller does not hold on the organization answers 403 role_exceeds_caller_permissions.",
  })
  .withMiddleware(roleRestFacts)
  .handle(async ({ app, input, actor }, organization) =>
    wire(
      await app.updateRoleInOrganization(
        {
          roleId: input.id,
          organizationId: organization.organizationId,
          changes: {
            ...(input.name === void 0 ? {} : { name: input.name }),
            ...(input.description === void 0 ? {} : { description: input.description }),
            ...(input.permissions === void 0 ? {} : { permissions: input.permissions }),
          },
        },
        callerOf(actor, organization.apiKeyId),
      ),
    ),
  )

  .delete("/:id", "deleteRole")
  .withParams(roleRestParamsSchema)
  .withPermission("organization:manage")
  .withOutput(roleRestDeletedSchema)
  .withDocs({
    tags: ["Roles"],
    description:
      "Delete a custom role. A role that anything still holds, a legacy team assignment or a role binding, answers 409 custom_role_in_use with the counts in meta. A built-in role answers 409 role_is_built_in.",
  })
  .withMiddleware(roleRestFacts)
  .handle(async ({ app, input, actor }, organization) =>
    app.deleteRoleInOrganization(
      { roleId: input.id, organizationId: organization.organizationId },
      callerOf(actor, organization.apiKeyId),
    ),
  )
  .build();
