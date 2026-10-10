/**
 * The server half of `role.*`. Three procedures name a ROLE, not an
 * organization, so they are service-authorized and `update` asks its plan in
 * the service too: with no scope to resolve, it cannot be declared.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { RoleApi, roleTrpc } from "@langwatch/role-contract";

const ROLE_ORGANIZATION_IS_DATA =
  "the role's organization is loaded by its id, so the check runs there rather than on input";

export const roleTrpcTransport: TrpcRouterDeclaration<RoleApi, typeof roleTrpc> = defineTrpcRouter(
  RoleApi,
  roleTrpc,
)
  /**
   * Role definitions are an admin-surface read: every screen that lists them
   * already requires manage, so a member session cannot reach them directly.
   */
  .procedure("getAll")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) =>
    app.listRoles({ organizationId: input.organizationId, builtIn: false }),
  )

  .procedure("getById")
  .serviceAuthorized({
    reason: ROLE_ORGANIZATION_IS_DATA,
    permissions: ["organization:view"],
  })
  .handle(async ({ app, input, actor }) => app.getRole({ roleId: input.roleId }, actor))

  .procedure("create")
  .withEntitlement("enterprise", { feature: "RBAC" })
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) =>
    app.createRole(
      {
        role: {
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          permissions: input.permissions,
        },
      },
      actor,
    ),
  )

  .procedure("update")
  .serviceAuthorized({
    reason: ROLE_ORGANIZATION_IS_DATA,
    permissions: ["organization:manage"],
  })
  .handle(async ({ app, input, actor }) =>
    app.updateRole(
      {
        roleId: input.roleId,
        changes: {
          name: input.name,
          description: input.description,
          permissions: input.permissions,
        },
      },
      actor,
    ),
  )

  .procedure("delete")
  .serviceAuthorized({
    reason: ROLE_ORGANIZATION_IS_DATA,
    permissions: ["organization:manage"],
  })
  .handle(async ({ app, input, actor }) => app.deleteRole({ roleId: input.roleId }, actor))

  // Assigning a custom role is the Enterprise capability, refused on every plan below it.
  .procedure("assignToUser")
  .withEntitlement("enterprise", { feature: "RBAC" })
  .withPermission({ kind: "permission", permission: "organization:manage", via: "teamId" })
  .handle(async ({ app, input, actor }) =>
    app.assignRoleToUser(
      { userId: input.userId, teamId: input.teamId, customRoleId: input.customRoleId },
      actor,
    ),
  )

  .procedure("removeFromUser")
  .withPermission({ kind: "permission", permission: "organization:manage", via: "teamId" })
  .handle(async ({ app, input, actor }) =>
    app.removeRoleFromUser({ userId: input.userId, teamId: input.teamId }, actor),
  )
  .build();
