import {
  OrganizationUserRole,
  TeamUserRole,
  type PrismaClient,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { env } from "~/env.mjs";

export const teamRolePermissionMapping = {
  SETUP_PROJECT: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  ANALYTICS_VIEW: [
    TeamUserRole.ADMIN,
    TeamUserRole.MEMBER,
    TeamUserRole.VIEWER,
  ],
  ANALYTICS_MANAGE: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  COST_VIEW: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  MESSAGES_VIEW: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
  MESSAGES_SHARE: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  ANNOTATIONS_VIEW: [
    TeamUserRole.ADMIN,
    TeamUserRole.MEMBER,
    TeamUserRole.VIEWER,
  ],
  SPANS_DEBUG: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  GUARDRAILS_VIEW: [
    TeamUserRole.ADMIN,
    TeamUserRole.MEMBER,
    TeamUserRole.VIEWER,
  ],
  GUARDRAILS_MANAGE: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  EXPERIMENTS_MANAGE: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  DATASETS_VIEW: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  DATASETS_MANAGE: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  ANNOTATIONS_MANAGE: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  TRIGGERS_MANAGE: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  PLAYGROUND: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  WORKFLOWS_VIEW: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  WORKFLOWS_MANAGE: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  TEAM_MEMBERS_MANAGE: [TeamUserRole.ADMIN],
  TEAM_CREATE_NEW_PROJECTS: [TeamUserRole.ADMIN],
};

export const organizationRolePermissionMapping = {
  ORGANIZATION_VIEW: [OrganizationUserRole.ADMIN, OrganizationUserRole.MEMBER],
  ORGANIZATION_MANAGE: [OrganizationUserRole.ADMIN],
  ORGANIZATION_USAGE: [
    OrganizationUserRole.ADMIN,
    OrganizationUserRole.MEMBER,
    OrganizationUserRole.EXTERNAL,
  ],
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

const isDemoProject = (projectId: string, roleGroup: string): boolean => {
  if (
    projectId === env.DEMO_PROJECT_ID &&
    (roleGroup === TeamRoleGroup.MESSAGES_VIEW ||
      roleGroup === TeamRoleGroup.DATASETS_VIEW ||
      roleGroup === TeamRoleGroup.ANALYTICS_VIEW ||
      roleGroup === TeamRoleGroup.COST_VIEW ||
      roleGroup === TeamRoleGroup.SPANS_DEBUG ||
      roleGroup === TeamRoleGroup.GUARDRAILS_VIEW ||
      roleGroup === TeamRoleGroup.ANNOTATIONS_VIEW ||
      roleGroup === TeamRoleGroup.PLAYGROUND)
  ) {
    return true;
  }
  return false;
};

type PermissionMiddlewareParams<InputType> = {
  ctx: {
    prisma: PrismaClient;
    session: Session;
    permissionChecked: boolean;
    publiclyShared: boolean;
  };
  input: InputType;
  next: () => any;
};

export type PermissionMiddleware<InputType> = (
  params: PermissionMiddlewareParams<InputType>
) => Promise<any>;

type PublicResourceTypes = "TRACE" | "THREAD";

export const checkPermissionOrPubliclyShared =
  <
    Key extends keyof InputType,
    InputType extends { [key in Key]: string } & { projectId: string },
  >(
    permissionCheck: PermissionMiddleware<InputType>,
    {
      resourceType,
      resourceParam,
    }: {
      resourceType: PublicResourceTypes | ((input: any) => PublicResourceTypes);
      resourceParam: Key;
    }
  ) =>
  async ({ ctx, input, next }: PermissionMiddlewareParams<InputType>) => {
    let allowed;
    try {
      allowed = await permissionCheck({ ctx, input, next });
    } catch (e) {
      if (e instanceof TRPCError && e.code === "UNAUTHORIZED") {
        allowed = false;
      }
    }

    if (!allowed) {
      const sharedResource = await ctx.prisma.publicShare.findFirst({
        where: {
          resourceType:
            typeof resourceType === "function"
              ? resourceType(input)
              : resourceType,
          resourceId: input[resourceParam],
        },
      });
      if (!sharedResource) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      ctx.publiclyShared = true;
    }

    ctx.permissionChecked = true;
    return next();
  };

export const checkUserPermissionForProject =
  (roleGroup: keyof typeof TeamRoleGroup) =>
  async ({
    ctx,
    input,
    next,
  }: PermissionMiddlewareParams<{ projectId: string }>) => {
    if (!(await backendHasTeamProjectPermission(ctx, input, roleGroup))) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    ctx.permissionChecked = true;
    return next();
  };

export const backendHasTeamProjectPermission = async (
  ctx: { prisma: PrismaClient; session: Session | null },
  input: { projectId: string },
  roleGroup: keyof typeof TeamRoleGroup
) => {
  if (!ctx.session?.user) {
    return false;
  }

  if (isDemoProject(input.projectId, roleGroup)) {
    return true;
  }

  const projectTeam = await ctx.prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      team: {
        select: { members: { where: { userId: ctx.session.user.id } } },
      },
    },
  });

  const teamMember = projectTeam?.team.members.find(
    (member) => member.userId === ctx.session?.user.id
  );

  return (
    projectTeam &&
    projectTeam.team.members.length > 0 &&
    teamMember &&
    (teamRolePermissionMapping[roleGroup] as TeamUserRole[]).includes(
      teamMember.role
    )
  );
};

export const checkUserPermissionForTeam =
  (roleGroup: keyof typeof TeamRoleGroup) =>
  async ({
    ctx,
    input,
    next,
  }: PermissionMiddlewareParams<{ teamId: string }>) => {
    if (!(await backendHasTeamPermission(ctx, input, roleGroup))) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    ctx.permissionChecked = true;
    return next();
  };

export const backendHasTeamPermission = async (
  ctx: { prisma: PrismaClient; session: Session },
  input: { teamId: string },
  roleGroup: keyof typeof TeamRoleGroup
) => {
  if (!ctx.session?.user) {
    return false;
  }

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
    return true;
  }

  const teamUser = await ctx.prisma.teamUser.findFirst({
    where: {
      userId: ctx.session.user.id,
      teamId: input.teamId,
    },
  });

  return (
    teamUser &&
    (teamRolePermissionMapping[roleGroup] as TeamUserRole[]).includes(
      teamUser.role
    )
  );
};

export const checkUserPermissionForOrganization =
  (roleGroup: keyof typeof OrganizationRoleGroup) =>
  async ({
    ctx,
    input,
    next,
  }: PermissionMiddlewareParams<{ organizationId: string }>) => {
    if (!(await backendHasOrganizationPermission(ctx, input, roleGroup))) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    ctx.permissionChecked = true;
    return next();
  };

export const backendHasOrganizationPermission = async (
  ctx: { prisma: PrismaClient; session: Session },
  input: { organizationId: string },
  roleGroup: keyof typeof OrganizationRoleGroup
) => {
  if (!ctx.session?.user) {
    return false;
  }

  const organizationUser = await ctx.prisma.organizationUser.findFirst({
    where: {
      userId: ctx.session.user.id,
      organizationId: input.organizationId,
    },
  });

  return (
    organizationUser &&
    (
      organizationRolePermissionMapping[roleGroup] as OrganizationUserRole[]
    ).includes(organizationUser.role)
  );
};

export const skipPermissionCheck = ({
  ctx,
  next,
  input,
}: PermissionMiddlewareParams<object>) => {
  ctx.permissionChecked = true;

  const SENSITIVE_KEYS = ["organizationId", "teamId", "projectId"];

  for (const key of SENSITIVE_KEYS) {
    if (key in input) {
      throw new Error(
        `${key} is not allowed to be used without permission check`
      );
    }
  }

  return next();
};
