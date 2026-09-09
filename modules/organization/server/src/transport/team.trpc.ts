/**
 * The server half of `team.*`. `organization:view` reads, which the
 * application then narrows per caller; `team:manage` administers one team;
 * `organization:manage` creates one or reads the access matrix.
 *
 * The two capabilities the doors used to reach for - whether the caller may
 * administer the organization, and whether its plan carries custom roles  - 
 * are asked inside the application now, over the same permission service and
 * plan gate every other door uses.
 */

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
