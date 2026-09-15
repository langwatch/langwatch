/** Server-side team procedures with permission gates forwarding to application. */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { OrganizationApi, teamTrpc } from "@langwatch/organization-contract";

export const teamTrpcTransport = defineTrpcRouter(OrganizationApi, teamTrpc)
  .procedure("getBySlug")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) => app.getTeamBySlugForMember(input, { id: actor.id }))

  .procedure("getTeamsWithMembers")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) =>
    app.listTeamsWithProjects({ organizationId: input.organizationId }, { id: actor.id }),
  )

  .procedure("getTeamsWithRoleBindings")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.listTeamAccessMatrix({ organizationId: input.organizationId }))

  .procedure("getTeamWithMembers")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) => app.getTeamWithProjects(input, { id: actor.id }))

  .procedure("update")
  .withPermission("team:manage")
  .handle(async ({ app, input, actor }) => {
    await app.updateTeamMembers(input, { id: actor.id });

    return { success: true as const };
  })

  .procedure("createTeamWithMembers")
  .withPermission("organization:manage")
  .handle(({ app, input, actor }) => app.createTeamWithGatedMembers(input, { id: actor.id }))

  .procedure("archiveById")
  .withPermission("team:manage")
  .handle(async ({ app, input }) => {
    await app.archiveTeamById(input);

    return { success: true as const };
  })

  .procedure("removeMember")
  .withPermission("team:manage")
  .handle(async ({ app, input, actor }) => {
    await app.removeTeamMemberById(input, { id: actor.id });

    return { success: true as const, removedUserId: input.userId };
  })
  .build();
