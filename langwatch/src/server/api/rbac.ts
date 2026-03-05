import {
  OrganizationUserRole,
  type PrismaClient,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { env } from "~/env.mjs";

// ============================================================================
// PERMISSION DEFINITIONS
// ============================================================================

/**
 * Core actions that can be performed on resources
 */
export const Actions = {
  VIEW: "view",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  MANAGE: "manage", // Full CRUD + settings
  SHARE: "share",
} as const;

export type Action = (typeof Actions)[keyof typeof Actions];

/**
 * Resources in the system that can have permissions
 */
export const Resources = {
  ORGANIZATION: "organization",
  PROJECT: "project",
  TEAM: "team",
  ANALYTICS: "analytics",
  COST: "cost",
  TRACES: "traces",
  SCENARIOS: "scenarios",
  ANNOTATIONS: "annotations",
  EVALUATIONS: "evaluations",
  DATASETS: "datasets",
  TRIGGERS: "triggers",
  WORKFLOWS: "workflows",
  PROMPTS: "prompts",
  SECRETS: "secrets",
  PLAYGROUND: "playground",
} as const;

export type Resource = (typeof Resources)[keyof typeof Resources];

/**
 * Permission is a combination of resource and action
 * Format: "resource:action" (e.g., "analytics:view", "datasets:manage")
 */
export type Permission = `${Resource}:${Action}`;

// ============================================================================
// ROLE DEFINITIONS
// ============================================================================

/**
 * Define what permissions each team role has
 * This is the single source of truth for team permissions
 */
const TEAM_ROLE_PERMISSIONS: Record<TeamUserRole, Permission[]> = {
  [TeamUserRole.ADMIN]: [
    // Projects
    "project:view",
    "project:create",
    "project:update",
    "project:delete",
    "project:manage",
    // Analytics
    "analytics:view",
    "analytics:manage",
    // Cost
    "cost:view",
    // Traces
    "traces:view",
    "traces:share",
    // Annotations
    "annotations:view",
    "annotations:manage",
    // Evaluations
    "evaluations:view",
    "evaluations:manage",
    // Workflows
    "workflows:view",
    "workflows:manage",
    // Datasets
    "datasets:view",
    "datasets:manage",
    // Triggers
    "triggers:view",
    "triggers:manage",
    // Workflows
    "workflows:view",
    "workflows:manage",
    // Prompts
    "prompts:view",
    "prompts:manage",
    // Scenarios
    "scenarios:view",
    "scenarios:manage",
    // Secrets
    "secrets:view",
    "secrets:manage",
    // Team
    "team:view",
    "team:manage",
  ],
  [TeamUserRole.MEMBER]: [
    // Projects
    "project:view",
    "project:update",
    // Analytics
    "analytics:view",
    "analytics:manage",
    // Cost
    "cost:view",
    // Traces
    "traces:view",
    "traces:share",
    // Annotations
    "annotations:view",
    "annotations:manage",
    // Evaluations
    "evaluations:view",
    "evaluations:manage",
    // Workflows
    "workflows:view",
    "workflows:manage",
    // Datasets
    "datasets:view",
    "datasets:manage",
    // Triggers
    "triggers:view",
    "triggers:manage",
    // Workflows
    "workflows:view",
    "workflows:manage",
    // Prompts
    "prompts:view",
    "prompts:manage",
    // Scenarios
    "scenarios:view",
    "scenarios:manage",
    // Secrets
    "secrets:view",
    "secrets:manage",
    // Team
    "team:view",
  ],
  [TeamUserRole.VIEWER]: [
    // Projects
    "project:view",
    // Analytics
    "analytics:view",
    // Traces
    "traces:view",
    // Annotations
    "annotations:view",
    // Evaluations
    "evaluations:view",
    // Datasets
    "datasets:view",
    // Workflows
    "workflows:view",
    // Prompts
    "prompts:view",
    // Scenarios
    "scenarios:view",
    // Secrets
    "secrets:view",
    // Team
    "team:view",
  ],
  [TeamUserRole.CUSTOM]: [
    // CUSTOM role permissions fall back to VIEWER if no assignedRoleId or custom role has no permissions
    // Projects
    "project:view",
    // Analytics
    "analytics:view",
    // Traces
    "traces:view",
    // Annotations
    "annotations:view",
    // Evaluations
    "evaluations:view",
    // Datasets
    "datasets:view",
    // Workflows
    "workflows:view",
    // Prompts
    "prompts:view",
    // Scenarios
    "scenarios:view",
    // Secrets
    "secrets:view",
    // Team
    "team:view",
  ],
};

/**
 * Define what permissions each organization role has
 */
const ORGANIZATION_ROLE_PERMISSIONS: Record<
  OrganizationUserRole,
  Permission[]
> = {
  [OrganizationUserRole.ADMIN]: [
    "organization:view",
    "organization:manage",
    "organization:delete",
  ],
  [OrganizationUserRole.MEMBER]: ["organization:view"],
  [OrganizationUserRole.EXTERNAL]: ["organization:view"], // Limited view for Lite Member users
};

// ============================================================================
// PERMISSION CHECKING
// ============================================================================

/**
 * Check if a permission list includes a requested permission, with hierarchy rules
 * manage permissions automatically include view, create, update, and delete permissions
 */
export function hasPermissionWithHierarchy(
  permissions: string[],
  requestedPermission: string,
): boolean {
  // Direct match
  if (permissions.includes(requestedPermission)) {
    return true;
  }

  // Hierarchy rule: manage permissions include view, create, update, and delete permissions
  const actionSuffixes = [":view", ":create", ":update", ":delete"];
  for (const suffix of actionSuffixes) {
    if (requestedPermission.endsWith(suffix)) {
      const managePermission = requestedPermission.replace(suffix, ":manage");
      if (permissions.includes(managePermission)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a team role has a specific permission
 */
export function teamRoleHasPermission(
  role: TeamUserRole,
  permission: Permission,
): boolean {
  return hasPermissionWithHierarchy(TEAM_ROLE_PERMISSIONS[role], permission);
}

/**
 * Check if an organization role has a specific permission
 */
export function organizationRoleHasPermission(
  role: OrganizationUserRole,
  permission: Permission,
): boolean {
  const rolePermissions = ORGANIZATION_ROLE_PERMISSIONS[role];
  return hasPermissionWithHierarchy(rolePermissions, permission);
}

/**
 * Get all permissions for a team role
 */
export function getTeamRolePermissions(role: TeamUserRole): Permission[] {
  return TEAM_ROLE_PERMISSIONS[role];
}

/**
 * Get all permissions for an organization role
 */
export function getOrganizationRolePermissions(
  role: OrganizationUserRole,
): Permission[] {
  return ORGANIZATION_ROLE_PERMISSIONS[role];
}

// ============================================================================
// HELPER FUNCTIONS FOR COMMON PERMISSION CHECKS
// ============================================================================

/**
 * Check if user can view a resource
 */
export function canView(role: TeamUserRole, resource: Resource): boolean {
  return teamRoleHasPermission(role, `${resource}:view` as Permission);
}

/**
 * Check if user can manage a resource (full CRUD)
 */
export function canManage(role: TeamUserRole, resource: Resource): boolean {
  return teamRoleHasPermission(role, `${resource}:manage` as Permission);
}

/**
 * Check if user can create a resource
 */
export function canCreate(role: TeamUserRole, resource: Resource): boolean {
  return teamRoleHasPermission(role, `${resource}:create` as Permission);
}

/**
 * Check if user can update a resource
 */
export function canUpdate(role: TeamUserRole, resource: Resource): boolean {
  return teamRoleHasPermission(role, `${resource}:update` as Permission);
}

/**
 * Check if user can delete a resource
 */
export function canDelete(role: TeamUserRole, resource: Resource): boolean {
  return teamRoleHasPermission(role, `${resource}:delete` as Permission);
}

// ============================================================================
// MIDDLEWARE & CONTEXT HELPERS
// ============================================================================

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

/**
 * Check if user has permission for a project
 */
export const checkProjectPermission =
  (permission: Permission) =>
  async ({
    ctx,
    input,
    next,
  }: PermissionMiddlewareParams<{ projectId: string }>) => {
    if (!(await hasProjectPermission(ctx, input.projectId, permission))) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    ctx.permissionChecked = true;
    return next();
  };

/**
 * Check if user has permission for a team
 */
export const checkTeamPermission =
  (permission: Permission) =>
  async ({
    ctx,
    input,
    next,
  }: PermissionMiddlewareParams<{ teamId: string }>) => {
    if (!(await hasTeamPermission(ctx, input.teamId, permission))) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    ctx.permissionChecked = true;
    return next();
  };

/**
 * Check if user has permission for an organization
 */
export const checkOrganizationPermission =
  (permission: Permission) =>
  async ({
    ctx,
    input,
    next,
  }: PermissionMiddlewareParams<{ organizationId: string }>) => {
    if (
      !(await hasOrganizationPermission(ctx, input.organizationId, permission))
    ) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    ctx.permissionChecked = true;
    return next();
  };

// ============================================================================
// BACKEND PERMISSION CHECKS
// ============================================================================

/**
 * Check if user has a specific permission for a project
 */
export async function hasProjectPermission(
  ctx: { prisma: PrismaClient; session: Session | null },
  projectId: string,
  permission: Permission,
): Promise<boolean> {
  if (!ctx.session?.user) {
    return false;
  }

  // Check demo project access
  if (isDemoProject(projectId, permission)) {
    return true;
  }

  const projectTeam = await ctx.prisma.project.findUnique?.({
    where: { id: projectId },
    select: {
      team: {
        select: {
          id: true,
          members: {
            where: { userId: ctx.session.user.id },
            select: {
              userId: true,
              teamId: true,
              role: true,
              assignedRoleId: true,
            },
          },
        },
      },
    },
  });

  const teamMember = projectTeam?.team.members.find(
    (member) => member.userId === ctx.session?.user.id,
  );

  if (!teamMember) {
    return false;
  }

  // Check user's individual permissions (custom role or built-in role)
  if (teamMember.assignedRoleId) {
    const customRole = await ctx.prisma.customRole.findUnique({
      where: { id: teamMember.assignedRoleId },
    });

    if (customRole) {
      const rawPermissions = customRole.permissions as
        | string[]
        | null
        | undefined;
      const userPermissions = Array.isArray(rawPermissions)
        ? rawPermissions
        : [];

      // If custom role has permissions, use them; otherwise fall back to built-in role
      if (userPermissions.length > 0) {
        return hasPermissionWithHierarchy(userPermissions, permission);
      }
      // Fall back to built-in role if custom role has no permissions
      return teamRoleHasPermission(teamMember.role, permission);
    }
  }

  // Only fall back to built-in team role if NO custom role exists
  return teamRoleHasPermission(teamMember.role, permission);
}

/**
 * Check if user has a specific permission for a team
 */
export async function hasTeamPermission(
  ctx: { prisma: PrismaClient; session: Session },
  teamId: string,
  permission: Permission,
): Promise<boolean> {
  if (!ctx.session?.user) {
    return false;
  }

  const team = await ctx.prisma.team.findUnique?.({
    where: { id: teamId },
    include: {},
  });

  if (!team?.organizationId) {
    return false;
  }

  // Check organization admin override
  const organizationUser = await ctx.prisma.organizationUser?.findFirst({
    where: {
      userId: ctx.session.user.id,
      organizationId: team.organizationId,
    },
  });

  // Organization ADMINs can do anything on all teams
  if (organizationUser?.role === OrganizationUserRole.ADMIN) {
    return true;
  }

  // Check team membership
  const teamUser = await ctx.prisma.teamUser?.findFirst({
    where: {
      userId: ctx.session.user.id,
      teamId: teamId,
    },
    select: {
      userId: true,
      teamId: true,
      role: true,
      assignedRoleId: true,
    },
  });

  if (!teamUser) {
    return false;
  }

  // Check user's individual permissions (custom role or built-in role)
  if (teamUser.assignedRoleId) {
    const customRole = await ctx.prisma.customRole.findUnique({
      where: { id: teamUser.assignedRoleId },
    });

    if (customRole) {
      const rawPermissions = customRole.permissions as
        | string[]
        | null
        | undefined;
      const userPermissions = Array.isArray(rawPermissions)
        ? rawPermissions
        : [];
      if (hasPermissionWithHierarchy(userPermissions, permission)) {
        return true;
      }
    }
  }

  // Fall back to user's built-in team role only
  return teamRoleHasPermission(teamUser.role, permission);
}

/**
 * Check if user has a specific permission for an organization
 */
export async function hasOrganizationPermission(
  ctx: { prisma: PrismaClient; session: Session },
  organizationId: string,
  permission: Permission,
): Promise<boolean> {
  if (!ctx.session?.user) {
    return false;
  }

  const organizationUser = await ctx.prisma.organizationUser?.findFirst({
    where: {
      userId: ctx.session.user.id,
      organizationId: organizationId,
    },
  });

  // Only check organization role - team admins do NOT get automatic organization permissions
  if (organizationUser) {
    const orgResult = organizationRoleHasPermission(
      organizationUser.role,
      permission,
    );
    if (orgResult) return true;
  }

  return false;
}

// ============================================================================
// DEMO PROJECT HANDLING
// ============================================================================

const DEMO_VIEW_PERMISSIONS: Permission[] = [
  "project:view",
  "analytics:view",
  "cost:view",
  "traces:view",
  "annotations:view",
  "datasets:view",
  "evaluations:view",
  "workflows:view",
  "prompts:view",
  "scenarios:view",
  "playground:view",
];

export function isDemoProject(
  projectId: string,
  permission: Permission,
): boolean {
  if (!projectId || projectId !== env.DEMO_PROJECT_ID) {
    // Prefer dynamic process.env in tests; fall back to env.DEMO_PROJECT_ID
    const demoId = process.env.DEMO_PROJECT_ID ?? env.DEMO_PROJECT_ID;
    if (!demoId || projectId !== demoId) {
      return false;
    }
  }

  return DEMO_VIEW_PERMISSIONS.includes(permission);
}

// ============================================================================
// SKIP PERMISSION CHECK (for public/special routes)
// ============================================================================

const SENSITIVE_KEYS = ["organizationId", "teamId", "projectId"] as const;
type SensitiveKey = (typeof SENSITIVE_KEYS)[number];
type SkipPermissionCheckOptions = {
  allow?: Partial<Record<SensitiveKey, string>>;
};

function isMiddlewareParams(
  value: unknown,
): value is PermissionMiddlewareParams<object> {
  return typeof value === "object" && value !== null && "ctx" in value;
}

/**
 * Permission middleware for endpoints that need authentication but not resource-level access.
 *
 * Use this when:
 * - User must be logged in (via `protectedProcedure`)
 * - No project/team/org-scoped data is accessed
 * - Examples: user preferences, feature flags, global settings
 *
 * By default, blocks `projectId`, `organizationId`, and `teamId` in the input
 * to prevent accidental resource access without permission checks.
 *
 * @param options.allow - Map of keys to reasons explaining why they're allowed
 */
export function skipPermissionCheck(
  options?: SkipPermissionCheckOptions,
): (params: PermissionMiddlewareParams<object>) => ReturnType<typeof params.next>;
export function skipPermissionCheck(
  params: PermissionMiddlewareParams<object>,
): ReturnType<typeof params.next>;
export function skipPermissionCheck(
  paramsOrOptions?:
    | PermissionMiddlewareParams<object>
    | SkipPermissionCheckOptions,
) {
  if (isMiddlewareParams(paramsOrOptions)) {
    const { ctx, next, input } = paramsOrOptions;
    ctx.permissionChecked = true;

    for (const key of SENSITIVE_KEYS) {
      if (key in input) {
        throw new Error(
          `${key} is not allowed to be used without permission check`,
        );
      }
    }

    return next();
  }

  const allowedKeys = Object.keys(paramsOrOptions?.allow ?? {});
  return ({ ctx, next, input }: PermissionMiddlewareParams<object>) => {
    ctx.permissionChecked = true;

    for (const key of SENSITIVE_KEYS) {
      if (key in input && !allowedKeys.includes(key)) {
        throw new Error(
          `${key} is not allowed to be used without permission check`,
        );
      }
    }

    return next();
  };
}

export const skipPermissionCheckProjectCreation = ({
  ctx,
  next,
}: PermissionMiddlewareParams<object>) => {
  ctx.permissionChecked = true;
  return next();
};

// ============================================================================
// PUBLIC SHARE HANDLING
// ============================================================================

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
    let allowed = false;
    try {
      await permissionCheck({
        ctx,
        input,
        next: async () => true as any,
      });
      allowed = true;
    } catch (e) {
      if (e instanceof TRPCError && e.code === "UNAUTHORIZED") {
        allowed = false;
      } else {
        throw e;
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
