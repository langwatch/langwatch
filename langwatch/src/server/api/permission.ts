import {
  OrganizationUserRole,
  TeamUserRole,
  type PrismaClient,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";

const teamRolePermissionMapping = {
  ANALYTICS_VIEW: [
    TeamUserRole.ADMIN,
    TeamUserRole.MEMBER,
    TeamUserRole.VIEWER,
  ],
  COST_VIEW: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  MESSAGES_VIEW: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
  GUARDRAILS_VIEW: [
    TeamUserRole.ADMIN,
    TeamUserRole.MEMBER,
    TeamUserRole.VIEWER,
  ],
  GUARDRAILS_MANAGE: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  TEAM_MEMBERS_VIEW: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  TEAM_MEMBERS_MANAGE: [TeamUserRole.ADMIN],
};

const organizationRolePermissionMapping = {
  ORGANIZATION_VIEW: [OrganizationUserRole.ADMIN, OrganizationUserRole.MEMBER],
  ORGANIZATION_MANAGE: [OrganizationUserRole.ADMIN],
};

export const TeamRoleGroup = Object.fromEntries(
  Object.keys(teamRolePermissionMapping).map((key) => [key, key])
) as Record<
  keyof typeof teamRolePermissionMapping,
  keyof typeof teamRolePermissionMapping
>;

export const OrganizationRoleGroup = Object.fromEntries(
  Object.keys(organizationRolePermissionMapping).map((key) => [key, key])
) as Record<
  keyof typeof organizationRolePermissionMapping,
  keyof typeof organizationRolePermissionMapping
>;

export const checkUserPermissionForProject =
  (roleGroup: keyof typeof TeamRoleGroup) =>
  async ({
    ctx,
    input,
    next,
  }: {
    ctx: { prisma: PrismaClient; session: Session };
    input: { projectId: string };
    next: () => any;
  }) => {
    const projectTeam = await ctx.prisma.project.findUnique({
      where: { id: input.projectId },
      select: {
        team: {
          select: { members: { where: { userId: ctx.session.user.id } } },
        },
      },
    });

    const teamMember = projectTeam?.team.members.find(
      (member) => member.userId === ctx.session.user.id
    );

    if (
      !projectTeam ||
      projectTeam.team.members.length === 0 ||
      !teamMember ||
      !(teamRolePermissionMapping[roleGroup] as TeamUserRole[]).includes(
        teamMember.role
      )
    ) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    return next();
  };

export const checkUserPermissionForTeam =
  (roleGroup: keyof typeof TeamRoleGroup) =>
  async ({
    ctx,
    input,
    next,
  }: {
    ctx: { prisma: PrismaClient; session: Session };
    input: { teamId: string };
    next: () => any;
  }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { id: input.teamId },
    });
    const organizationId = team?.organizationId;
    if (!organizationId) {
      throw "Organization not found for team";
    }

    const organizationUser = await ctx.prisma.organizationUser.findFirst({
      where: {
        userId: ctx.session.user.id,
        organizationId,
      },
    });

    // Organization ADMINs can do anything on all teams
    if (organizationUser?.role === OrganizationUserRole.ADMIN) {
      return next();
    }

    const teamUser = await ctx.prisma.teamUser.findFirst({
      where: {
        userId: ctx.session.user.id,
        teamId: input.teamId,
      },
    });

    if (
      !teamUser ||
      !(teamRolePermissionMapping[roleGroup] as TeamUserRole[]).includes(
        teamUser.role
      )
    ) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    return next();
  };

export const checkUserPermissionForOrganization =
  (roleGroup: keyof typeof OrganizationRoleGroup) =>
  async ({
    ctx,
    input,
    next,
  }: {
    ctx: { prisma: PrismaClient; session: Session };
    input: { organizationId: string };
    next: () => any;
  }) => {
    const organizationUser = await ctx.prisma.organizationUser.findFirst({
      where: {
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      },
    });

    if (
      !organizationUser ||
      !(
        organizationRolePermissionMapping[roleGroup] as OrganizationUserRole[]
      ).includes(organizationUser.role)
    ) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    return next();
  };
