import {
  OrganizationUserRole,
  type PrismaClient,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { env } from "~/env.mjs";
import type { Permission } from "./rbac";

// ============================================================================
// LEGACY PERMISSION SYSTEM (for backward compatibility)
// ============================================================================
// This will be gradually phased out in favor of the new RBAC system
// See ./rbac.ts for the new permission system

// Organized nested permissions structure for better readability
// Each section groups related permissions together
const teamPermissions: Record<string, Record<string, TeamUserRole[]>> = {
  // Administrative resources first
  organization: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
    manage: [TeamUserRole.ADMIN],
  },
  project: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
    setup: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
    archive: [TeamUserRole.ADMIN],
    changeCapturedDataVisibility: [TeamUserRole.ADMIN],
  },
  team: {
    membersManage: [TeamUserRole.ADMIN],
    archive: [TeamUserRole.ADMIN],
    createNewProjects: [TeamUserRole.ADMIN],
  },
  // Functional resources
  analytics: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
    manage: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
  cost: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
  messages: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
    share: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
  scenarios: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
    manage: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
  annotations: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
    manage: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
  guardrails: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
    manage: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
  workflows: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
    manage: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
  datasets: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
    manage: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
  triggers: {
    manage: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
  prompts: {
    view: [TeamUserRole.ADMIN, TeamUserRole.MEMBER, TeamUserRole.VIEWER],
    manage: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
  playground: {
    access: [TeamUserRole.ADMIN, TeamUserRole.MEMBER],
  },
};

// Exported flat mapping maintains backward compatibility with exact old key names
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const teamRolePermissionMapping = {
  // Project permissions
  SETUP_PROJECT: teamPermissions.project!.setup!,
  ARCHIVE_PROJECT: teamPermissions.project!.archive!,
  PROJECT_VIEW: teamPermissions.project!.view!,
  PROJECT_CHANGE_CAPTURED_DATA_VISIBILITY:
    teamPermissions.project!.changeCapturedDataVisibility!,

  // Analytics permissions
  ANALYTICS_VIEW: teamPermissions.analytics!.view!,
  ANALYTICS_MANAGE: teamPermissions.analytics!.manage!,

  // Cost permissions
  COST_VIEW: teamPermissions.cost!.view!,

  // Messages permissions
  MESSAGES_VIEW: teamPermissions.messages!.view!,
  MESSAGES_SHARE: teamPermissions.messages!.share!,

  // Annotations permissions
  ANNOTATIONS_VIEW: teamPermissions.annotations!.view!,
  ANNOTATIONS_MANAGE: teamPermissions.annotations!.manage!,

  // Guardrails permissions
  GUARDRAILS_VIEW: teamPermissions.guardrails!.view!,
  GUARDRAILS_MANAGE: teamPermissions.guardrails!.manage!,

  WORKFLOWS_VIEW: teamPermissions.workflows!.view!,
  WORKFLOWS_MANAGE: teamPermissions.workflows!.manage!,

  // Datasets permissions
  DATASETS_VIEW: teamPermissions.datasets!.view!,
  DATASETS_MANAGE: teamPermissions.datasets!.manage!,

  // Triggers permissions
  TRIGGERS_MANAGE: teamPermissions.triggers!.manage!,

  // Playground permissions
  PLAYGROUND: teamPermissions.playground!.access!,

  // Prompts permissions
  PROMPTS_VIEW: teamPermissions.prompts!.view!,
  PROMPTS_MANAGE: teamPermissions.prompts!.manage!,

  // Team permissions
  TEAM_MEMBERS_MANAGE: teamPermissions.team!.membersManage!,
  TEAM_ARCHIVE: teamPermissions.team!.archive!,
  TEAM_CREATE_NEW_PROJECTS: teamPermissions.team!.createNewProjects!,

  // Scenarios permissions
  SCENARIOS_VIEW: teamPermissions.scenarios!.view!,
  SCENARIOS_MANAGE: teamPermissions.scenarios!.manage!,
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
  Object.keys(teamRolePermissionMapping).map((key) => [key, key]),
) as Record<
  keyof typeof teamRolePermissionMapping,
  keyof typeof teamRolePermissionMapping
>;

export const OrganizationRoleGroup = Object.fromEntries(
  Object.keys(organizationRolePermissionMapping).map((key) => [key, key]),
) as Record<
  keyof typeof organizationRolePermissionMapping,
  keyof typeof organizationRolePermissionMapping
>;

export const isDemoProject = (
  projectId: string,
  roleGroup: string,
): boolean => {
  if (
    projectId === env.DEMO_PROJECT_ID &&
    (roleGroup === TeamRoleGroup.MESSAGES_VIEW ||
      roleGroup === TeamRoleGroup.DATASETS_VIEW ||
      roleGroup === TeamRoleGroup.ANALYTICS_VIEW ||
      roleGroup === TeamRoleGroup.COST_VIEW ||
      roleGroup === TeamRoleGroup.GUARDRAILS_VIEW ||
      roleGroup === TeamRoleGroup.ANNOTATIONS_VIEW ||
      roleGroup === TeamRoleGroup.PLAYGROUND ||
      roleGroup === TeamRoleGroup.PROJECT_VIEW ||
      roleGroup === TeamRoleGroup.WORKFLOWS_VIEW ||
      roleGroup === TeamRoleGroup.PROMPTS_VIEW ||
      roleGroup === TeamRoleGroup.SCENARIOS_VIEW)
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
  params: PermissionMiddlewareParams<InputType>,
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
    },
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
  roleGroup: keyof typeof OrganizationRoleGroup,
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
        `${key} is not allowed to be used without permission check`,
      );
    }
  }

  return next();
};

export const skipPermissionCheckProjectCreation = ({
  ctx,
  next,
}: PermissionMiddlewareParams<object>) => {
  ctx.permissionChecked = true;

  return next();
};

// ============================================================================
// MIGRATION HELPERS - Bridge between old and new RBAC systems
// ============================================================================

/**
 * Mapping from legacy TeamRoleGroup keys to new RBAC permissions
 * This allows gradual migration to the new system
 */
export const LEGACY_TO_RBAC_MAPPING: Partial<
  Record<keyof typeof TeamRoleGroup, Permission>
> = {
  PROJECT_VIEW: "project:view",
  SETUP_PROJECT: "project:update",
  ARCHIVE_PROJECT: "project:delete",
  PROJECT_CHANGE_CAPTURED_DATA_VISIBILITY: "project:manage",
  ANALYTICS_VIEW: "analytics:view",
  ANALYTICS_MANAGE: "analytics:manage",
  COST_VIEW: "cost:view",
  MESSAGES_VIEW: "traces:view",
  MESSAGES_SHARE: "traces:share",
  ANNOTATIONS_VIEW: "annotations:view",
  ANNOTATIONS_MANAGE: "annotations:manage",
  WORKFLOWS_VIEW: "workflows:view",
  WORKFLOWS_MANAGE: "workflows:manage",
  DATASETS_VIEW: "datasets:view",
  DATASETS_MANAGE: "datasets:manage",
  TRIGGERS_MANAGE: "triggers:manage",
  PROMPTS_VIEW: "prompts:view",
  PROMPTS_MANAGE: "prompts:manage",
  TEAM_MEMBERS_MANAGE: "team:manage",
  TEAM_ARCHIVE: "team:delete",
  TEAM_CREATE_NEW_PROJECTS: "project:create",
  SCENARIOS_VIEW: "scenarios:view",
  SCENARIOS_MANAGE: "scenarios:manage",
};

/**
 * Convert legacy permission to new RBAC permission
 */
export function legacyToRbacPermission(
  legacyKey: keyof typeof TeamRoleGroup,
): Permission | undefined {
  return LEGACY_TO_RBAC_MAPPING[legacyKey];
}
