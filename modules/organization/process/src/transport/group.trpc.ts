/**
 * The server half of `group.*`: every procedure asks `organization:manage`.
 * listAll and create declare the SCIM plan gate (create's covers custom roles);
 * addGrant and applyEdits ask RBAC only when they grant a custom role.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  assignsGroupCustomRole,
  groupTrpc,
  OrganizationApi,
} from "@langwatch/organization-contract";

const customRoleGate = { feature: "RBAC", when: assignsGroupCustomRole };

export const groupTrpcTransport: TrpcRouterDeclaration<OrganizationApi, typeof groupTrpc> =
  defineTrpcRouter(OrganizationApi, groupTrpc)
    .procedure("listAll")
    .withEntitlement("enterprise", { feature: "SCIM" })
    .withPermission("organization:manage")
    .handle(({ app, input }) => app.listGroupsWithScopeNames(input))

    .procedure("getById")
    .withPermission("organization:manage")
    .handle(({ app, input }) => app.getGroupWithScopeNames(input))

    .procedure("create")
    .withEntitlement("enterprise", { feature: "SCIM" })
    .withPermission("organization:manage")
    .handle(({ app, input, actor }) => app.createLicensedGroup(input, { id: actor.id }))

    .procedure("addGrant")
    .withEntitlement("enterprise", customRoleGate)
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) => {
      const { organizationId, groupId, ...grant } = input;
      const created = await app.addGroupGrant({ organizationId, groupId, grant }, { id: actor.id });

      return { id: created.id };
    })

    .procedure("removeGrant")
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) => {
      await app.removeGroupGrant(input, { id: actor.id });

      return { success: true as const };
    })

    .procedure("addMember")
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) => {
      await app.addGroupMember(input, { id: actor.id });

      return { success: true as const };
    })

    .procedure("delete")
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) => {
      await app.deleteGroup({ ...input, allowScimManaged: true }, { id: actor.id });

      return { success: true as const };
    })

    .procedure("rename")
    .withPermission("organization:manage")
    .handle(({ app, input }) => app.renameGroup(input))

    .procedure("listForMember")
    .withPermission("organization:manage")
    .handle(({ app, input }) => app.listMemberGroupsWithScopeNames(input))

    .procedure("removeMember")
    .withPermission("organization:manage")
    .handle(async ({ app, input }) => {
      await app.removeGroupMember(input);

      return { success: true as const };
    })

    .procedure("applyEdits")
    .withEntitlement("enterprise", customRoleGate)
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) => {
      await app.applyGroupEdits(input, { id: actor.id });

      return { success: true as const };
    })
    .build();
