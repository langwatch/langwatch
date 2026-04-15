import {
  OrganizationUserRole,
  RoleBindingScopeType,
  type PrismaClient,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Session } from "~/server/auth";
import { env } from "~/env.mjs";
import { LiteMemberRestrictedError } from "~/server/app-layer/permissions/errors";
import { isAdmin } from "../../../ee/admin/isAdmin";

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
  OPS: "ops",
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

/**
 * Default permission set for EXTERNAL (lite member) users.
 * Currently identical to VIEWER — lite members can view all resources but
 * cannot create, edit, or manage them. Maintained as a separate constant so
 * it can diverge from VIEWER independently if needed.
 *
 * Custom roles, when assigned to EXTERNAL users, override these defaults
 * (see resolveProjectPermission).
 */
export const EXTERNAL_MEMBER_PERMISSIONS: Permission[] = [
  "project:view",
  "analytics:view",
  "traces:view",
  "annotations:view",
  "annotations:create",
  "annotations:update",
  "evaluations:view",
  "datasets:view",
  "workflows:view",
  "prompts:view",
  "scenarios:view",
  "secrets:view",
  "team:view",
];

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
// PERMISSION RESULT TYPE
// ============================================================================

/**
 * Result of resolving a permission check, including the user's organization role.
 * Used by resolve* functions to provide richer context than a simple boolean.
 */
export type PermissionResult = {
  permitted: boolean;
  organizationRole: OrganizationUserRole | null;
};

// ============================================================================
// MIDDLEWARE & CONTEXT HELPERS
// ============================================================================

type PermissionMiddlewareParams<InputType> = {
  ctx: {
    prisma: PrismaClient;
    session: Session;
    permissionChecked: boolean;
    publiclyShared: boolean;
    organizationRole?: OrganizationUserRole | null;
    opsScope?: OpsScope;
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
    const { permitted, organizationRole } = await resolveProjectPermission(
      ctx,
      input.projectId,
      permission,
    );

    if (!permitted) {
      if (organizationRole === OrganizationUserRole.EXTERNAL) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This feature is not available for your account",
          cause: new LiteMemberRestrictedError(permission.split(":")[0] ?? "unknown"),
        });
      }
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You do not have permission to access this project resource",
      });
    }

    ctx.organizationRole = organizationRole;
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
    const { permitted, organizationRole } = await resolveTeamPermission(
      ctx,
      input.teamId,
      permission,
    );

    if (!permitted) {
      if (organizationRole === OrganizationUserRole.EXTERNAL) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This feature is not available for your account",
          cause: new LiteMemberRestrictedError(permission.split(":")[0] ?? "unknown"),
        });
      }
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You do not have permission to access this team resource",
      });
    }

    ctx.organizationRole = organizationRole;
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
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          "You do not have permission to access this organization resource",
      });
    }

    ctx.permissionChecked = true;
    return next();
  };

// ============================================================================
// BACKEND PERMISSION CHECKS
// ============================================================================

// ============================================================================
// ROLE BINDING RESOLUTION
// ============================================================================

/**
 * Checks whether any of the user's RoleBindings at the given scopes grants the
 * requested permission. All matching bindings are evaluated and their permission
 * sets are unioned — a user is permitted if ANY binding grants the permission.
 *
 * Falls back to the legacy TeamUser table when no RoleBindings exist.
 */
async function checkPermissionFromBindings({
  prisma,
  userId,
  organizationId,
  scopes,
  organizationRole,
  permission,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
  organizationRole: OrganizationUserRole | null;
  permission: Permission;
}): Promise<boolean> {
  const scopeIds = scopes.map((s) => s.scopeId);

  // Fetch groups the user belongs to in this org
  const groupMemberships = await prisma.groupMembership.findMany({
    where: { userId, group: { organizationId } },
    select: { groupId: true },
  });
  const groupIds = groupMemberships.map((m) => m.groupId);

  // Fetch all matching RoleBindings for this user (direct + via groups) across all scopes
  const bindings = await prisma.roleBinding.findMany({
    where: {
      organizationId,
      scopeId: { in: scopeIds },
      OR: [
        { userId },
        ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
      ],
    },
    select: { role: true, customRoleId: true },
  });

  if (bindings.length === 0) {
    // Fall back to legacy TeamUser for users not yet migrated to RoleBindings
    const teamScope = scopes.find(
      (s) => s.scopeType === RoleBindingScopeType.TEAM,
    );
    if (!teamScope) return false;

    const teamUser = await prisma.teamUser.findFirst({
      where: { userId, teamId: teamScope.scopeId },
      select: { role: true, assignedRoleId: true },
    });

    if (!teamUser) return false;
    return resolveBindingPermission(
      { role: teamUser.role, customRoleId: teamUser.assignedRoleId ?? null },
      organizationRole,
      permission,
      prisma,
    );
  }

  // Union permissions across ALL matching bindings — permitted if any grants it
  for (const binding of bindings) {
    const permitted = await resolveBindingPermission(
      binding,
      organizationRole,
      permission,
      prisma,
    );
    if (permitted) return true;
  }

  return false;
}

/**
 * Checks whether a single binding grants the requested permission,
 * respecting EXTERNAL user restrictions and custom role permission lists.
 */
async function resolveBindingPermission(
  binding: { role: TeamUserRole; customRoleId: string | null },
  organizationRole: OrganizationUserRole | null,
  permission: Permission,
  prisma: PrismaClient,
): Promise<boolean> {
  if (binding.customRoleId) {
    const customRole = await prisma.customRole.findUnique({
      where: { id: binding.customRoleId },
    });
    if (customRole) {
      const perms = Array.isArray(customRole.permissions)
        ? (customRole.permissions as string[])
        : [];
      if (perms.length > 0) {
        return hasPermissionWithHierarchy(perms, permission);
      }
    }
  }

  if (organizationRole === OrganizationUserRole.EXTERNAL) {
    return hasPermissionWithHierarchy(EXTERNAL_MEMBER_PERMISSIONS, permission);
  }

  return teamRoleHasPermission(binding.role, permission);
}

/**
 * Resolve a project permission check, returning the permission decision
 * along with the user's organization role.
 */
export async function resolveProjectPermission(
  ctx: { prisma: PrismaClient; session: Session | null },
  projectId: string,
  permission: Permission,
): Promise<PermissionResult> {
  if (!ctx.session?.user) {
    return { permitted: false, organizationRole: null };
  }

  // Check demo project access
  if (isDemoProject(projectId, permission)) {
    return { permitted: true, organizationRole: null };
  }

  const projectTeam = await ctx.prisma.project.findUnique?.({
    where: { id: projectId },
    select: {
      team: {
        select: {
          id: true,
          organizationId: true,
          organization: {
            select: {
              members: {
                where: { userId: ctx.session.user.id },
                select: { role: true },
              },
            },
          },
        },
      },
    },
  });

  const teamId = projectTeam?.team.id;
  const organizationId = projectTeam?.team.organizationId;
  const organizationRole =
    projectTeam?.team.organization?.members[0]?.role ?? null;

  if (!teamId || !organizationId) {
    return { permitted: false, organizationRole };
  }

  const permitted = await checkPermissionFromBindings({
    prisma: ctx.prisma,
    userId: ctx.session.user.id,
    organizationId,
    scopes: [
      { scopeType: RoleBindingScopeType.PROJECT, scopeId: projectId },
      { scopeType: RoleBindingScopeType.TEAM, scopeId: teamId },
      { scopeType: RoleBindingScopeType.ORGANIZATION, scopeId: organizationId },
    ],
    organizationRole,
    permission,
  });

  return { permitted, organizationRole };
}

/**
 * Check if user has a specific permission for a project
 */
export async function hasProjectPermission(
  ctx: { prisma: PrismaClient; session: Session | null },
  projectId: string,
  permission: Permission,
): Promise<boolean> {
  const result = await resolveProjectPermission(ctx, projectId, permission);
  return result.permitted;
}

/**
 * Resolve a team permission check, returning the permission decision
 * along with the user's organization role.
 */
export async function resolveTeamPermission(
  ctx: { prisma: PrismaClient; session: Session | null },
  teamId: string,
  permission: Permission,
): Promise<PermissionResult> {
  if (!ctx.session?.user) {
    return { permitted: false, organizationRole: null };
  }

  const team = await ctx.prisma.team.findUnique?.({
    where: { id: teamId },
    include: {},
  });

  if (!team?.organizationId) {
    return { permitted: false, organizationRole: null };
  }

  const organizationUser = await ctx.prisma.organizationUser?.findFirst({
    where: { userId: ctx.session.user.id, organizationId: team.organizationId },
  });

  const organizationRole = organizationUser?.role ?? null;

  // Org ADMINs can do anything on all teams
  if (organizationUser?.role === OrganizationUserRole.ADMIN) {
    return { permitted: true, organizationRole };
  }

  const permitted = await checkPermissionFromBindings({
    prisma: ctx.prisma,
    userId: ctx.session.user.id,
    organizationId: team.organizationId,
    scopes: [
      { scopeType: RoleBindingScopeType.TEAM, scopeId: teamId },
      { scopeType: RoleBindingScopeType.ORGANIZATION, scopeId: team.organizationId },
    ],
    organizationRole,
    permission,
  });

  return { permitted, organizationRole };
}

/**
 * Check if user has a specific permission for a team
 */
export async function hasTeamPermission(
  ctx: { prisma: PrismaClient; session: Session | null },
  teamId: string,
  permission: Permission,
): Promise<boolean> {
  const result = await resolveTeamPermission(ctx, teamId, permission);
  return result.permitted;
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
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission and this resource is not publicly shared",
        });
      }
      ctx.publiclyShared = true;
    }

    ctx.permissionChecked = true;
    return next();
  };

// ============================================================================
// OPS PERMISSION
// ============================================================================

export type OpsScope =
  | { kind: "platform" }
  | { kind: "organization"; organizationId: string };

/**
 * Resolve the ops scope for a user. Returns null if the user has no ops access.
 * Shared between tRPC middleware and SSE endpoint.
 *
 * Admins and OPS_ORG_ID members bypass the permission check and receive
 * platform-level access. For regular org members, `permission` is checked
 * against their role bindings via `resolveBindingPermission`.
 */
export async function resolveOpsScope({
  userId,
  userEmail,
  permission,
  prisma,
}: {
  userId: string;
  userEmail: string | null | undefined;
  permission: Permission;
  prisma: Parameters<typeof resolveBindingPermission>[3];
}): Promise<OpsScope | null> {
  if (isAdmin({ email: userEmail })) {
    return { kind: "platform" };
  }

  if (env.IS_SAAS && env.OPS_ORG_ID) {
    const membership = await prisma.organizationUser.findFirst({
      where: { userId, organizationId: env.OPS_ORG_ID },
    });
    if (membership) {
      return { kind: "platform" };
    }
  }

  const memberships = await prisma.organizationUser.findMany({
    where: { userId },
    select: { organizationId: true },
  });

  for (const membership of memberships) {
    const bindings = await prisma.roleBinding.findMany({
      where: {
        organizationId: membership.organizationId,
        userId,
      },
      select: { role: true, customRoleId: true },
    });

    for (const binding of bindings) {
      const permitted = await resolveBindingPermission(
        binding,
        null,
        permission,
        prisma,
      );
      if (permitted) {
        return {
          kind: "organization",
          organizationId: membership.organizationId,
        };
      }
    }
  }

  return null;
}

export const checkOpsPermission =
  (permission: Permission) =>
  async ({
    ctx,
    next,
  }: PermissionMiddlewareParams<unknown>) => {
    const user = ctx.session?.user;
    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const opsScope = await resolveOpsScope({
      userId: user.id,
      userEmail: user.email,
      permission,
      prisma: ctx.prisma,
    });

    if (!opsScope) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to access ops resources",
      });
    }

    ctx.opsScope = opsScope;
    ctx.permissionChecked = true;
    return next();
  };
