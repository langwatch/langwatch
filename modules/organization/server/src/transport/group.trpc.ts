/**
 * The server half of `group.*`. A group is an access grant, so every
 * procedure asks `organization:manage`. Groups arrive with SCIM, so listing
 * and creating one also clear the Enterprise plan gate, which the application
 * asks now rather than the door.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { groupTrpc, OrganizationApi } from "@langwatch/organization-contract";

export const groupTrpcTransport = defineTrpcRouter(OrganizationApi, groupTrpc)
  .procedure("listAll")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.listGroupsWithScopeNames(input))

  .procedure("getById")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.getGroupWithScopeNames(input))

  .procedure("create")
  .withPermission("organization:manage")
  .handle(({ app, input, actor }) => app.createLicensedGroup(input, { id: actor.id }))

  .procedure("addBinding")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) => {
    const { organizationId, groupId, ...binding } = input;
    const created = await app.addGroupBinding(
      { organizationId, groupId, binding },
      { id: actor.id },
    );

    return { id: created.id };
  })

  .procedure("removeBinding")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) => {
    await app.removeGroupBinding(input, { id: actor.id });

    return { success: true as const };
  })

  .procedure("addMember")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) => {
    await app.addGroupMember(input);

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
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) => {
    await app.applyGroupEdits(input, { id: actor.id });

    return { success: true as const };
  })
  .build();
