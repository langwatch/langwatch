import { organizationTeamMemberInputSchema } from "@langwatch/organization-contract";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { probeOrganizationPermission } from "~/server/app-layer/permissions/imperative";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
  isCustomRole,
} from "../enterprise";

export const teamRouter = createTRPCRouter({
  getBySlug: protectedProcedure
    .input(z.object({ organizationId: z.string(), slug: z.string() }))
    .permission("organization:view")
    .query(({ input, ctx }) =>
      ctx.app.organizations.getTeamBySlugForMember({
        ...input,
        userId: ctx.session.user.id,
      }),
    ),

  getTeamsWithMembers: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
    .query(async ({ input, ctx }) => {
      const callerCanManage = await probeOrganizationPermission(
        ctx,
        input.organizationId,
        "organization:manage",
      );
      const [teams, projects] = await Promise.all([
        ctx.app.organizations.listTeamsWithMembers({
          organizationId: input.organizationId,
          callerUserId: ctx.session.user.id,
          callerCanManage,
        }),
        ctx.app.projects.listByOrganization({
          organizationId: input.organizationId,
          page: 1,
          limit: 1_000,
        }),
      ]);
      return teams.map((team) => ({
        ...team,
        projects: projects.data.filter(({ teamId }) => teamId === team.id),
      }));
    }),

  getTeamsWithRoleBindings: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:manage")
    .query(async ({ input, ctx }) => {
      const projects = await ctx.app.projects.listByOrganization({
        organizationId: input.organizationId,
        page: 1,
        limit: 1_000,
      });
      return ctx.app.organizations.listTeamAccess({
        organizationId: input.organizationId,
        projects: projects.data.map(({ id, name, teamId }) => ({
          id,
          name,
          teamId,
        })),
      });
    }),

  getTeamWithMembers: protectedProcedure
    .input(z.object({ slug: z.string(), organizationId: z.string() }))
    .permission("organization:view")
    .query(async ({ input, ctx }) => {
      const callerCanManage = await probeOrganizationPermission(
        ctx,
        input.organizationId,
        "organization:manage",
      );
      const team = await ctx.app.organizations.getTeamWithMembers({
        ...input,
        callerUserId: ctx.session.user.id,
        callerCanManage,
      });
      const projects = await ctx.app.projects.listByTeam({
        organizationId: input.organizationId,
        teamId: team.id,
      });
      return { ...team, projects };
    }),

  update: protectedProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string(),
        members: z.array(organizationTeamMemberInputSchema),
      }),
    )
    .permission("team:manage")
    .mutation(async ({ input, ctx }) => {
      const team = await ctx.app.organizations.getTeamById({
        teamId: input.teamId,
      });
      if (input.members.some(({ role }) => isCustomRole(role))) {
        await assertEnterprisePlan({
          planProvider: ctx.app.planProvider,
          organizationId: team.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }
      await ctx.app.organizations.updateTeamWithMembers({
        ...input,
        actor: { type: "user", id: ctx.session.user.id },
      });
      return { success: true as const };
    }),

  createTeamWithMembers: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string(),
        members: z.array(organizationTeamMemberInputSchema),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      if (input.members.some(({ role }) => isCustomRole(role))) {
        await assertEnterprisePlan({
          planProvider: ctx.app.planProvider,
          organizationId: input.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }
      return ctx.app.organizations.createTeamWithMembers({
        ...input,
        actor: { type: "user", id: ctx.session.user.id },
      });
    }),

  archiveById: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .permission("team:manage")
    .mutation(async ({ input, ctx }) => {
      const team = await ctx.app.organizations.getTeamById(input);
      await ctx.app.organizations.archiveTeam({
        teamId: team.id,
        organizationId: team.organizationId,
      });
      return { success: true as const };
    }),

  removeMember: protectedProcedure
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .permission("team:manage")
    .mutation(async ({ input, ctx }) => {
      const team = await ctx.app.organizations.getTeamById({
        teamId: input.teamId,
      });
      await ctx.app.organizations.removeTeamMember({
        ...input,
        organizationId: team.organizationId,
        actor: { type: "user", id: ctx.session.user.id },
      });
      return { success: true as const, removedUserId: input.userId };
    }),
});
