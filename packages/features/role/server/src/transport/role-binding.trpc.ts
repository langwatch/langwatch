/**
 * The server half of `roleBinding.*`. Every read is audit-grade authorization
 * data, so the surface stays at `organization:manage` apart from the caller's
 * own breakdown, which is their own standing.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { RoleApi, roleBindingTrpc } from "@langwatch/role-contract";

export const roleBindingTrpcTransport = defineTrpcRouter(RoleApi, roleBindingTrpc)
  .procedure("listForOrg")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) =>
    app.listBindingsForOrganization({ organizationId: input.organizationId }),
  )

  /** One member's bindings, cheaper than listing the organization and filtering. */
  .procedure("listForUser")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) =>
    app.listBindingsForUser({ organizationId: input.organizationId, userId: input.userId }),
  )

  .procedure("getMyAccessBreakdown")
  .withPermission("organization:view")
  .handle(async ({ app, input, actor }) =>
    app.getCallerAccessBreakdown({ organizationId: input.organizationId }, actor),
  )

  .procedure("create")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) =>
    app.createBinding(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        groupId: input.groupId,
        role: input.role,
        customRoleId: input.customRoleId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      },
      actor,
    ),
  )

  .procedure("update")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) =>
    app.updateBinding(
      {
        organizationId: input.organizationId,
        bindingId: input.bindingId,
        role: input.role,
        customRoleId: input.customRoleId,
      },
      actor,
    ),
  )

  .procedure("delete")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) =>
    app.deleteBinding({ organizationId: input.organizationId, bindingId: input.bindingId }, actor),
  )

  .procedure("applyMemberBindings")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) =>
    app.applyMemberBindings(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        bindingIdsToDelete: input.bindingIdsToDelete,
        bindingsToCreate: input.bindingsToCreate,
      },
      actor,
    ),
  )
  .build();
