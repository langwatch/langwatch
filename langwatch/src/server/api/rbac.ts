import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { env } from "~/env.mjs";
import { LiteMemberRestrictedError } from "~/server/app-layer/permissions/errors";
import type { Session } from "~/server/auth";
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
  // Gateway-specific actions: `rotate` is a sub-action of `update` for virtual
  // keys but callers may want to grant it independently. `attach`/`detach`
  // apply to guardrails — these are also treated as sub-actions of `update`
  // by the hierarchy helper below.
  ROTATE: "rotate",
  ATTACH: "attach",
  DETACH: "detach",
  // Resource-specific cross-principal audit action. Used today by
  // `virtualKeys:viewOtherPersonal` so org admins can see every member's
  // personal VKs during off-boarding sweeps. Personal-VK self-view stays
  // implicit on principalUserId match (no perm needed for "see my own").
  VIEW_OTHER_PERSONAL: "viewOtherPersonal",
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
  // Experiments are their own capability: a user can run experiments on
  // prompts or agents without touching the workflow studio. Historically they
  // inherited `workflows:view`; this dedicated permission decouples them.
  EXPERIMENTS: "experiments",
  PROMPTS: "prompts",
  SECRETS: "secrets",
  PLAYGROUND: "playground",
  OPS: "ops",
  // Platform audit log — covers both the legacy AuditLog stream AND the
  // gateway-resource rows folded into it by the audit consolidation.
  // Lives outside the gateway permission family because it gates a
  // platform settings page (/settings/audit-log), not a gateway sub-page.
  AUDIT_LOG: "auditLog",
  // AI Gateway resources — see specs/ai-gateway/_shared/contract.md §10
  VIRTUAL_KEYS: "virtualKeys",
  GATEWAY_BUDGETS: "gatewayBudgets",
  GATEWAY_PROVIDERS: "gatewayProviders",
  // RoutingPolicies are Enterprise-tier gateway primitives (provider
  // chain + fallback + per-model rules). Granular permission lets
  // custom roles delegate routing-policy mgmt without granting
  // organization:manage. Mirrors gatewayProviders:* shape.
  ROUTING_POLICIES: "routingPolicies",
  GATEWAY_GUARDRAILS: "gatewayGuardrails",
  // Deprecated (kept for backwards-compat): pre-consolidation perm that
  // gated /[project]/gateway/audit. The page is gone; auditLog:view is
  // the live permission. Safe to drop in a future breaking-change pass.
  GATEWAY_LOGS: "gatewayLogs",
  GATEWAY_USAGE: "gatewayUsage",
  GATEWAY_CACHE_RULES: "gatewayCacheRules",
  // AI Governance resources — see specs/ai-gateway/governance/. These are
  // org-level (not project/team-level), so they live in
  // ORGANIZATION_ROLE_PERMISSIONS rather than the team role bags. Custom
  // roles can grant any subset via the existing CustomRolePermissions JSON
  // column without requiring a Prisma enum change.
  GOVERNANCE: "governance",
  INGESTION_SOURCES: "ingestionSources",
  ANOMALY_RULES: "anomalyRules",
  COMPLIANCE_EXPORT: "complianceExport",
  ACTIVITY_MONITOR: "activityMonitor",
  // AI Tools Portal (Phase 7) — the customizable per-org card grid on
  // /me. Two permissions:
  //   - aiTools:view → ALL org roles. Portal must work for every member
  //     so they can discover what's available + click through to setup.
  //   - aiTools:manage → org ADMIN only. Catalog editor surface at
  //     /settings/governance/tool-catalog (CRUD + reorder + enable).
  AI_TOOLS: "aiTools",
} as const;

export type Resource = (typeof Resources)[keyof typeof Resources];

/**
 * Permission is a combination of resource and action
 * Format: "resource:action" (e.g., "analytics:view", "datasets:manage")
 */
export type Permission = `${Resource}:${Action}`;

/**
 * Resources that only exist at the organization tier — there is no team- or
 * project-scoped meaning for them (the AI Governance family plus the
 * organization resource itself). Org-tier authority comes only from an
 * ORGANIZATION-scoped RoleBinding; a TEAM- or PROJECT-scoped binding must
 * never grant a permission on one of these, even via a custom role that lists
 * it. This is the defense the scope-chain resolvers apply so a custom role
 * misconfigured below the org tier can't escalate to organization:manage,
 * governance:manage, anomalyRules:manage, and so on (ADR-021).
 *
 * Gateway + core resources (virtualKeys, gatewayBudgets, datasets, workflows,
 * …) are deliberately NOT here: they are legitimately accessible at team and
 * project scope, so team/project bindings may grant them.
 */
const ORG_EXCLUSIVE_RESOURCES: ReadonlySet<Resource> = new Set<Resource>([
  Resources.ORGANIZATION,
  Resources.GOVERNANCE,
  Resources.INGESTION_SOURCES,
  Resources.ANOMALY_RULES,
  Resources.COMPLIANCE_EXPORT,
  Resources.ACTIVITY_MONITOR,
  Resources.AI_TOOLS,
]);

/** True when the permission targets an organization-tier-only resource. */
export function isOrgExclusivePermission(permission: Permission): boolean {
  const resource = permission.split(":")[0] as Resource;
  return ORG_EXCLUSIVE_RESOURCES.has(resource);
}

/**
 * Whether a binding at `scopeType` may grant `permission`. Org-exclusive
 * permissions require an ORGANIZATION-scoped binding; everything else is
 * grantable at any scope. Both the tRPC resolver (`checkPermissionFromBindings`)
 * and the gateway resolver (`checkRoleBindingPermission`) gate on this so the
 * rule holds no matter which path evaluates the binding.
 */
export function bindingScopeCanGrant(
  scopeType: RoleBindingScopeType,
  permission: Permission,
): boolean {
  if (scopeType === RoleBindingScopeType.ORGANIZATION) return true;
  return !isOrgExclusivePermission(permission);
}

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
    "traces:create",
    "traces:update",
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
    // Experiments
    "experiments:view",
    "experiments:manage",
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
    // AI Gateway (admin has full gateway CRUD + rotation)
    "virtualKeys:view",
    "virtualKeys:create",
    "virtualKeys:update",
    "virtualKeys:delete",
    "virtualKeys:rotate",
    "virtualKeys:manage",
    // Off-boarding sweep capability — view personal VKs owned by OTHER
    // users in the org (own personal-VK visibility stays implicit on
    // principalUserId match, no perm needed). Spec-bound to
    // vk-scope-rbac.feature + vk-personal-scope.feature.
    "virtualKeys:viewOtherPersonal",
    "gatewayBudgets:view",
    "gatewayBudgets:create",
    "gatewayBudgets:update",
    "gatewayBudgets:delete",
    "gatewayBudgets:manage",
    "gatewayProviders:view",
    "gatewayProviders:update",
    "gatewayProviders:manage",
    "routingPolicies:view",
    "routingPolicies:manage",
    "gatewayGuardrails:view",
    "gatewayGuardrails:attach",
    "gatewayGuardrails:detach",
    "gatewayGuardrails:manage",
    "gatewayLogs:view",
    "auditLog:view",
    "gatewayUsage:view",
    "gatewayCacheRules:view",
    "gatewayCacheRules:create",
    "gatewayCacheRules:update",
    "gatewayCacheRules:delete",
    "gatewayCacheRules:manage",
  ],
  [TeamUserRole.MEMBER]: [
    // Projects
    "project:view",
    "project:create",
    "project:update",
    // Analytics
    "analytics:view",
    "analytics:manage",
    // Cost
    "cost:view",
    // Traces
    "traces:view",
    "traces:create",
    "traces:update",
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
    // Experiments
    "experiments:view",
    "experiments:manage",
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
    // AI Gateway (member: can manage own VKs + see budgets, cannot delete budgets)
    "virtualKeys:view",
    "virtualKeys:create",
    "virtualKeys:update",
    "virtualKeys:rotate",
    "gatewayBudgets:view",
    "gatewayProviders:view",
    "routingPolicies:view",
    "gatewayGuardrails:view",
    "gatewayLogs:view",
    "auditLog:view",
    "gatewayUsage:view",
    "gatewayCacheRules:view",
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
    // Experiments
    "experiments:view",
    // Prompts
    "prompts:view",
    // Scenarios
    "scenarios:view",
    // Secrets
    "secrets:view",
    // Team
    "team:view",
    // AI Gateway (viewer: read-only)
    "virtualKeys:view",
    "gatewayBudgets:view",
    "gatewayProviders:view",
    "routingPolicies:view",
    "gatewayGuardrails:view",
    "gatewayLogs:view",
    "auditLog:view",
    "gatewayUsage:view",
    "gatewayCacheRules:view",
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
    // Experiments
    "experiments:view",
    // Prompts
    "prompts:view",
    // Scenarios
    "scenarios:view",
    // Secrets
    "secrets:view",
    // Team
    "team:view",
    // AI Gateway (custom role default: same baseline as VIEWER, overridable via CustomRole.permissions)
    "virtualKeys:view",
    "gatewayBudgets:view",
    "gatewayProviders:view",
    "routingPolicies:view",
    "gatewayGuardrails:view",
    "gatewayLogs:view",
    "auditLog:view",
    "gatewayUsage:view",
    "gatewayCacheRules:view",
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
    // AI Governance — org-level permissions for the governance offering
    // (anomaly rules, ingestion sources, OCSF SIEM export, activity
    // monitor, top-level Govern section). Default-attached to ADMIN so
    // admins can bootstrap their first IngestionSource without a
    // chicken-and-egg gate. MEMBER + EXTERNAL get nothing by default;
    // custom roles via CustomRolePermissions JSON column are the
    // production-shape delegation surface (e.g. a "security_analyst"
    // custom role granting governance:view + activityMonitor:view +
    // anomalyRules:view).
    "governance:view",
    "governance:manage",
    "ingestionSources:view",
    "ingestionSources:create",
    "ingestionSources:update",
    "ingestionSources:delete",
    "ingestionSources:manage",
    "anomalyRules:view",
    "anomalyRules:create",
    "anomalyRules:update",
    "anomalyRules:delete",
    "anomalyRules:manage",
    "complianceExport:view",
    "activityMonitor:view",
    // AI Tools Portal — admin owns the catalog. View is implicit via
    // the org-wide grant below (admins also see the user-facing portal).
    "aiTools:view",
    "aiTools:manage",
    // AI Gateway — org-level VK capabilities. `virtualKeys:manage`
    // mirrors the TeamUserRole.ADMIN grant so org admins can author VKs
    // at ORGANIZATION scope (the team-role short-circuit at
    // rbac.ts:715/:1099 covers existing customers automatically; the
    // explicit string here documents the perm-listing UI + future custom
    // roles that don't inherit the short-circuit). `viewOtherPersonal`
    // gives org admins the off-boarding sweep capability. Spec-bound to
    // vk-scope-rbac.feature.
    "virtualKeys:manage",
    "virtualKeys:viewOtherPersonal",
  ],
  // MEMBER + EXTERNAL get aiTools:view so the /me portal renders for
  // every org member. Catalog management stays admin-only.
  [OrganizationUserRole.MEMBER]: ["organization:view", "aiTools:view"],
  [OrganizationUserRole.EXTERNAL]: ["organization:view", "aiTools:view"],
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
  "experiments:view",
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

  // Hierarchy rule: manage permissions include view, create, update, delete,
  // and gateway-specific sub-actions (rotate, attach, detach).
  const actionSuffixes = [
    ":view",
    ":create",
    ":update",
    ":delete",
    ":rotate",
    ":attach",
    ":detach",
  ];
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
          cause: new LiteMemberRestrictedError(
            permission.split(":")[0] ?? "unknown",
          ),
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
          cause: new LiteMemberRestrictedError(
            permission.split(":")[0] ?? "unknown",
          ),
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
    select: { role: true, customRoleId: true, scopeType: true },
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
    // Legacy team membership is a TEAM-scoped grant, so it can't confer an
    // org-exclusive permission even through a custom role (ADR-021).
    if (!bindingScopeCanGrant(RoleBindingScopeType.TEAM, permission)) {
      return false;
    }
    return resolveBindingPermission(
      { role: teamUser.role, customRoleId: teamUser.assignedRoleId ?? null },
      organizationRole,
      permission,
      prisma,
    );
  }

  // Union permissions across ALL matching bindings — permitted if any grants it
  for (const binding of bindings) {
    // A team/project binding can never grant an org-exclusive permission,
    // even via a custom role that lists it (ADR-021).
    if (!bindingScopeCanGrant(binding.scopeType, permission)) continue;

    // Org-scoped bindings: ADMIN grants everything; MEMBER grants org-level permissions only.
    // ORG-scoped MEMBER bindings do NOT imply any team- or project-level access — team/project
    // access requires a TEAM- or PROJECT-scoped binding. Only org:* permissions are checked here.
    if (
      binding.scopeType === RoleBindingScopeType.ORGANIZATION &&
      binding.role !== TeamUserRole.CUSTOM
    ) {
      // Defense-in-depth: EXTERNAL (Lite Member) users must never be promoted
      // by this fast path even if an ORG-scoped MEMBER binding exists — the
      // OrganizationUser role is authoritative for EXTERNAL restrictions.
      if (organizationRole === OrganizationUserRole.EXTERNAL) continue;
      if (binding.role === TeamUserRole.ADMIN) return true;
      if (
        organizationRoleHasPermission(OrganizationUserRole.MEMBER, permission)
      )
        return true;
      continue;
    }

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
 *
 * See also checkRoleBindingPermission() in role-binding-resolver.ts which
 * implements parallel CUSTOM-role logic for API key resolution and must
 * stay in sync with the non-empty/empty fallthrough semantics here.
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
    select: { role: true },
  });

  const organizationRole = organizationUser?.role ?? null;

  const permitted = await checkPermissionFromBindings({
    prisma: ctx.prisma,
    userId: ctx.session.user.id,
    organizationId: team.organizationId,
    scopes: [
      { scopeType: RoleBindingScopeType.TEAM, scopeId: teamId },
      {
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: team.organizationId,
      },
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

  const userId = ctx.session.user.id;

  const orgMember = await ctx.prisma.organizationUser?.findFirst({
    where: { userId, organizationId },
    select: { role: true },
  });

  if (!orgMember) return false;

  // EXTERNAL (Lite Member) is a billing classification, not an access-control
  // boundary, so it must NOT cap organization-permission resolution. Removing
  // the old `organization:view`-only short-circuit lets a lite member reach the
  // MEMBER base bag below (`organization:view` + `aiTools:view`), which is what
  // the /me AI-tools portal needs to render. The binding-level guards in
  // `checkPermissionFromBindings` are unchanged: they still skip non-CUSTOM
  // ORGANIZATION-scoped bindings for EXTERNAL and cap non-CUSTOM team bindings
  // at EXTERNAL_MEMBER_PERMISSIONS, so a lite member does not escalate through
  // the default role bag. An explicit CUSTOM role binding is still honored for
  // EXTERNAL — that is the intended admin delegation surface (see the
  // EXTERNAL_MEMBER_PERMISSIONS docs), and it is unchanged here. So beyond the
  // MEMBER base bag this change adds, a lite member only ever gains what a
  // custom role was deliberately granted. (Fully retiring EXTERNAL as a
  // permission gate is the follow-up for when it becomes a computed property.)
  //
  // Regression: the short-circuit fired before the floor below and hid
  // `aiTools:view`, so a lite member's /me portal `aiTools.list` threw
  // UNAUTHORIZED and rendered the empty "your admin hasn't added any tools"
  // state even when an org-wide tool was published (customer report).

  // Universal personal-context floor: every org member, regardless of
  // role, gets MEMBER's base bag (`organization:view` + `aiTools:view`)
  // so /me works. Without this floor, a bare org-member with no team
  // membership AND no custom RoleBinding fell through every check
  // below and was rejected from every personal-context tRPC procedure
  // (user.personalContext / personalUsage / personalBudget /
  // homePagePickerState / governance.resolveHome / limits.getUsage /
  // aiTools.list — all gated on `organization:view`). Caught when
  // MEMBER `rogerio@…` was added to an org for the Claude Code OTLP
  // dogfood and his /me page permission-denied silently — the page
  // rendered as if no data existed instead of "no access".
  //
  // Critical: floor is MEMBER's bag *only*, NOT the role's full bag.
  // ADMIN-only org perms (`organization:manage` / `governance:manage`
  // / `ingestionSources:create` / etc.) still require an explicit
  // ORGANIZATION-scoped RoleBinding. A bare OrgUser.role=ADMIN with
  // no RoleBinding doesn't escalate — the existing legacy fallback
  // semantics expect RoleBindings (primary path) or TeamUser ADMIN
  // (limited team-resource fallback) to be the source of admin
  // power, not the OrgUser.role field by itself.
  if (organizationRoleHasPermission(OrganizationUserRole.MEMBER, permission)) {
    return true;
  }

  // Primary path: resolve via ORGANIZATION-scoped RoleBindings.
  const permittedByBindings = await checkPermissionFromBindings({
    prisma: ctx.prisma,
    userId,
    organizationId,
    scopes: [
      { scopeType: RoleBindingScopeType.ORGANIZATION, scopeId: organizationId },
    ],
    organizationRole: orgMember.role,
    permission,
  });
  if (permittedByBindings) return true;

  // Legacy fallback: users migrated before RoleBindings existed keep their
  // TeamUser row (with ADMIN/MEMBER/VIEWER role) but may have zero
  // RoleBindings. For org-scoped permission checks we union across every
  // TeamUser the user has in the organization — this matches the intent
  // that org ADMINs / team ADMINs have broad access to org-scoped gateway
  // resources (audit, org-level budgets, cache rules) without requiring a
  // RoleBinding backfill first.
  //
  // Personal teams are excluded: every user is ADMIN of their own
  // single-member personal workspace team, so unioning it here would let
  // any member escalate to the full org ADMIN template (including
  // virtualKeys:viewOtherPersonal / organization:manage) just by owning a
  // personal workspace. A personal team's legitimate ADMIN power is
  // team-scoped and flows through its TEAM-scoped RoleBinding, never this
  // org-wide union.
  // The team-membership union below is a TEAM-scoped grant applied to an
  // org-level check; org-exclusive permissions (organization:* / governance
  // family) are never conferred through it — only an ORGANIZATION-scoped
  // binding can (ADR-021). Gateway/audit resources stay grantable here.
  if (!bindingScopeCanGrant(RoleBindingScopeType.TEAM, permission)) {
    return false;
  }
  const teamMemberships = await ctx.prisma.teamUser.findMany({
    where: { userId, team: { organizationId, isPersonal: false } },
    select: { role: true, assignedRoleId: true },
  });
  for (const tu of teamMemberships) {
    const permitted = await resolveBindingPermission(
      { role: tu.role, customRoleId: tu.assignedRoleId ?? null },
      orgMember.role,
      permission,
      ctx.prisma,
    );
    if (permitted) return true;
  }
  return false;
}

/**
 * Batched team + project permission check used by surfaces that need to
 * test the SAME permission across many scopes inside one organization
 * (e.g. the model-defaults settings page enumerating every team +
 * project the caller can read/write). One scoped permission check costs
 * ~3-5 queries (team/project lookup, organizationUser, groupMembership,
 * roleBinding, optional customRole). N team + M project checks ran in a
 * Promise.all fan-out, that's hundreds of queries per page load on large
 * orgs.
 *
 * This helper does the four lookups ONCE — groupMembership, roleBinding
 * (with scopeId IN the union of all team/project/org ids), customRole
 * (for any binding referencing one), and legacy teamUser — then
 * resolves each id in-memory against the same rules
 * `checkPermissionFromBindings` applies.
 *
 * Project resolution still needs to know the project's team so a
 * team-scoped binding inherits to its projects. Callers pass the
 * project→teamId map alongside the project ids.
 */
/**
 * The permission-INDEPENDENT half of a scoped permission check, loaded once.
 *
 * Every lookup a scoped check makes — the caller's org membership, their group
 * memberships, the role bindings on the scopes in play, the custom roles those
 * bindings reference, and the legacy TeamUser fallback — is the same regardless
 * of WHICH permission is being asked about. Only `bindingGrants` consults the
 * permission, and it is pure.
 *
 * Separating the two is what lets a caller ask about N permissions for the price
 * of one round of queries instead of N rounds. That is not merely a speed-up: a
 * caller that fanned N checks out concurrently wanted N connections from the
 * Prisma pool AT ONCE, and starved anything sharing it — including an interactive
 * transaction with a 5s budget, which then aborted and failed the request
 * outright. Fewer queries is the fix; making the same queries faster is not.
 */
type ScopeResolution = {
  organizationRole: OrganizationUserRole | null;
  bindingsByScope: Map<string, ResolvedBinding[]>;
  customRoleById: Map<string, { id: string; permissions: unknown }>;
  /** No RoleBindings at all for this user ⇒ fall back to legacy TeamUser roles. */
  needsLegacyFallback: boolean;
  legacyByTeam: Map<
    string,
    { role: TeamUserRole; assignedRoleId: string | null }
  >;
};

type ResolvedBinding = {
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
};

const scopeKey = (scopeType: RoleBindingScopeType, scopeId: string) =>
  `${scopeType}::${scopeId}`;

/**
 * Loads everything a scoped permission decision needs, in ~4 queries, for ANY
 * number of permissions and scopes. Returns null when the caller is not a member
 * of the organization at all — the "no" that short-circuits every question.
 */
async function loadScopeResolution(
  ctx: { prisma: PrismaClient; session: Session | null },
  args: { organizationId: string; scopeIds: string[] },
): Promise<ScopeResolution | null> {
  const userId = ctx.session?.user?.id;
  if (!userId) return null;

  const orgMember = await ctx.prisma.organizationUser?.findFirst({
    where: { userId, organizationId: args.organizationId },
    select: { role: true },
  });
  if (!orgMember) return null;

  const groupMemberships = await ctx.prisma.groupMembership.findMany({
    where: { userId, group: { organizationId: args.organizationId } },
    select: { groupId: true },
  });
  const groupIds = groupMemberships.map((m) => m.groupId);

  const scopeIds = [args.organizationId, ...args.scopeIds];
  const bindings: ResolvedBinding[] =
    scopeIds.length > 0
      ? await ctx.prisma.roleBinding.findMany({
          where: {
            organizationId: args.organizationId,
            scopeId: { in: scopeIds },
            OR: [
              { userId },
              ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
            ],
          },
          select: {
            role: true,
            customRoleId: true,
            scopeType: true,
            scopeId: true,
          },
        })
      : [];

  const customRoleIds = Array.from(
    new Set(
      bindings.map((b) => b.customRoleId).filter((id): id is string => !!id),
    ),
  );
  const customRoles =
    customRoleIds.length > 0
      ? await ctx.prisma.customRole.findMany({
          where: { id: { in: customRoleIds } },
          select: { id: true, permissions: true },
        })
      : [];

  const bindingsByScope = new Map<string, ResolvedBinding[]>();
  for (const b of bindings) {
    const key = scopeKey(b.scopeType, b.scopeId);
    const list = bindingsByScope.get(key) ?? [];
    list.push(b);
    bindingsByScope.set(key, list);
  }

  // Legacy fallback: a user with NO RoleBindings anywhere in the org falls back
  // to their TeamUser role. Mirrored here so the batch paths keep exact parity
  // with the per-call helpers.
  const needsLegacyFallback = bindings.length === 0;
  const legacyTeamUser = needsLegacyFallback
    ? await ctx.prisma.teamUser.findMany({
        where: { userId, team: { organizationId: args.organizationId } },
        select: { teamId: true, role: true, assignedRoleId: true },
      })
    : [];

  return {
    organizationRole: orgMember.role,
    bindingsByScope,
    customRoleById: new Map(customRoles.map((c) => [c.id, c])),
    needsLegacyFallback,
    legacyByTeam: new Map(
      legacyTeamUser.map((t) => [
        t.teamId,
        { role: t.role, assignedRoleId: t.assignedRoleId },
      ]),
    ),
  };
}

/**
 * Does this ONE binding grant this ONE permission? Pure — no I/O.
 *
 * This is the only part of a scoped check that depends on the permission, which
 * is why the loader above can be shared across all of them.
 */
function bindingGrants(
  resolution: ScopeResolution,
  binding: {
    role: TeamUserRole;
    customRoleId: string | null;
    scopeType: RoleBindingScopeType;
  },
  permission: Permission,
): boolean {
  // A team/project binding can never grant an org-exclusive permission, even via
  // a custom role that lists it (ADR-021).
  if (!bindingScopeCanGrant(binding.scopeType, permission)) return false;

  if (binding.customRoleId) {
    const custom = resolution.customRoleById.get(binding.customRoleId);
    if (custom) {
      const perms = Array.isArray(custom.permissions)
        ? (custom.permissions as string[])
        : [];
      if (perms.length > 0) {
        return hasPermissionWithHierarchy(perms, permission);
      }
    }
  }

  if (binding.scopeType === RoleBindingScopeType.ORGANIZATION) {
    if (binding.role === TeamUserRole.CUSTOM) return false;
    if (resolution.organizationRole === OrganizationUserRole.EXTERNAL) {
      return false;
    }
    if (binding.role === TeamUserRole.ADMIN) return true;
    return organizationRoleHasPermission(
      OrganizationUserRole.MEMBER,
      permission,
    );
  }

  if (resolution.organizationRole === OrganizationUserRole.EXTERNAL) {
    return hasPermissionWithHierarchy(EXTERNAL_MEMBER_PERMISSIONS, permission);
  }
  return teamRoleHasPermission(binding.role, permission);
}

/** Does the caller hold `permission` on this project, given a loaded resolution? */
function projectGrants(
  resolution: ScopeResolution,
  args: { organizationId: string; projectId: string; teamId?: string },
  permission: Permission,
): boolean {
  const grantedBy = (key: string) =>
    (resolution.bindingsByScope.get(key) ?? []).some((b) =>
      bindingGrants(resolution, b, permission),
    );

  if (
    grantedBy(scopeKey(RoleBindingScopeType.ORGANIZATION, args.organizationId))
  ) {
    return true;
  }
  if (grantedBy(scopeKey(RoleBindingScopeType.PROJECT, args.projectId))) {
    return true;
  }
  if (args.teamId) {
    if (grantedBy(scopeKey(RoleBindingScopeType.TEAM, args.teamId))) {
      return true;
    }
    if (resolution.needsLegacyFallback) {
      const legacy = resolution.legacyByTeam.get(args.teamId);
      if (legacy) {
        return bindingGrants(
          resolution,
          {
            role: legacy.role,
            customRoleId: legacy.assignedRoleId,
            scopeType: RoleBindingScopeType.TEAM,
          },
          permission,
        );
      }
    }
  }
  return false;
}

/** Does the caller hold `permission` on this team, given a loaded resolution? */
function teamGrants(
  resolution: ScopeResolution,
  args: { organizationId: string; teamId: string },
  permission: Permission,
): boolean {
  const grantedBy = (key: string) =>
    (resolution.bindingsByScope.get(key) ?? []).some((b) =>
      bindingGrants(resolution, b, permission),
    );

  if (
    grantedBy(scopeKey(RoleBindingScopeType.ORGANIZATION, args.organizationId))
  ) {
    return true;
  }
  if (grantedBy(scopeKey(RoleBindingScopeType.TEAM, args.teamId))) return true;
  if (resolution.needsLegacyFallback) {
    const legacy = resolution.legacyByTeam.get(args.teamId);
    if (legacy) {
      return bindingGrants(
        resolution,
        {
          role: legacy.role,
          customRoleId: legacy.assignedRoleId,
          scopeType: RoleBindingScopeType.TEAM,
        },
        permission,
      );
    }
  }
  return false;
}

/**
 * MANY permissions, ONE project scope — resolved in ~4 queries total.
 *
 * The counterpart axis to `batchScopePermissions` (one permission, many scopes),
 * and the fix for the pattern that function's own docstring warns about: a caller
 * that needs to know which of N permissions a user holds must NOT issue N scoped
 * checks. Langy's session-key mint did exactly that — 27 candidate permissions at
 * ~3 queries each, ~81 queries per chat turn. Serially that was ~500ms of latency;
 * fanned out with Promise.all it became ~81 connections demanded at once, which
 * starved the Prisma pool and made `ApiKeyService.create`'s interactive
 * transaction exceed its 5-second budget and abort — turning a slow turn into a
 * failed one.
 *
 * Returns the held subset, in the order given, so callers can use it directly as
 * a least-privilege grant list.
 */
export async function batchProjectPermissions(
  ctx: { prisma: PrismaClient; session: Session | null },
  args: {
    organizationId: string;
    projectId: string;
    teamId?: string;
    permissions: Permission[];
  },
): Promise<Permission[]> {
  const resolution = await loadScopeResolution(ctx, {
    organizationId: args.organizationId,
    scopeIds: [args.projectId, ...(args.teamId ? [args.teamId] : [])],
  });
  if (!resolution) return [];

  return args.permissions.filter((permission) =>
    projectGrants(
      resolution,
      {
        organizationId: args.organizationId,
        projectId: args.projectId,
        ...(args.teamId ? { teamId: args.teamId } : {}),
      },
      permission,
    ),
  );
}

/**
 * Batched team + project permission check used by surfaces that need to
 * test the SAME permission across many scopes inside one organization
 * (e.g. the model-defaults settings page enumerating every team +
 * project the caller can read/write). One scoped permission check costs
 * ~3-5 queries (team/project lookup, organizationUser, groupMembership,
 * roleBinding, optional customRole). N team + M project checks ran in a
 * Promise.all fan-out, that's hundreds of queries per page load on large
 * orgs.
 *
 * This helper does the four lookups ONCE — via `loadScopeResolution` — then
 * resolves each id in-memory against the same rules a per-call check applies.
 *
 * Project resolution still needs to know the project's team so a
 * team-scoped binding inherits to its projects. Callers pass the
 * project→teamId map alongside the project ids.
 */
export async function batchScopePermissions(
  ctx: { prisma: PrismaClient; session: Session | null },
  args: {
    organizationId: string;
    teamIds: string[];
    projectIds: string[];
    projectTeamId: Record<string, string>;
    permission: Permission;
  },
): Promise<{ teams: Map<string, boolean>; projects: Map<string, boolean> }> {
  const teamsMap = new Map<string, boolean>();
  const projectsMap = new Map<string, boolean>();

  const resolution = await loadScopeResolution(ctx, {
    organizationId: args.organizationId,
    scopeIds: [...args.teamIds, ...args.projectIds],
  });
  if (!resolution) {
    args.teamIds.forEach((id) => teamsMap.set(id, false));
    args.projectIds.forEach((id) => projectsMap.set(id, false));
    return { teams: teamsMap, projects: projectsMap };
  }

  for (const teamId of args.teamIds) {
    teamsMap.set(
      teamId,
      teamGrants(
        resolution,
        { organizationId: args.organizationId, teamId },
        args.permission,
      ),
    );
  }

  for (const projectId of args.projectIds) {
    const teamId = args.projectTeamId[projectId];
    projectsMap.set(
      projectId,
      projectGrants(
        resolution,
        {
          organizationId: args.organizationId,
          projectId,
          ...(teamId ? { teamId } : {}),
        },
        args.permission,
      ),
    );
  }

  return { teams: teamsMap, projects: projectsMap };
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
  "experiments:view",
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
): (
  params: PermissionMiddlewareParams<object>,
) => ReturnType<typeof params.next>;
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

/**
 * For procedures that authorize against data-dependent scopes resolved at
 * runtime (e.g. a row's own scope set, loaded by id) rather than a fixed
 * input scope a `checkXxxPermission` could read. It satisfies the builder's
 * fail-closed `enforcePermissionCheck` while keeping `protectedProcedure`'s
 * auth + audit + domain-error handling. The resolver/service MUST perform
 * the real authorization — this only defers WHERE the check happens, never
 * whether it happens.
 */
export const authorizeInResolver = ({
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
          projectId: input.projectId,
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

/**
 * Discriminated scope every authenticated user has — `none` means "no ops
 * access" (the honest answer for a non-ops user), `platform` means "full
 * platform-wide access". Modeled this way so `getScope` can be a status
 * probe that returns data instead of throwing FORBIDDEN on every page
 * load (lw#3584).
 */
export type OpsScope = { kind: "none" } | { kind: "platform" };

/**
 * Resolve the ops scope for a user. Always returns a typed scope value;
 * non-ops users get `{ kind: "none" }` instead of null. Shared between
 * tRPC middleware (which still rejects non-ops callers via
 * `checkOpsPermission`) and the SSE endpoint.
 *
 * Only users listed in ADMIN_EMAILS get the `platform` scope. All ops
 * data is platform-wide so no org-scoped tier exists.
 */
export function resolveOpsScope({
  userEmail,
}: {
  userId: string;
  userEmail: string | null | undefined;
  permission: Permission;
  prisma: unknown;
}): OpsScope {
  if (isAdmin({ email: userEmail })) {
    return { kind: "platform" };
  }

  return { kind: "none" };
}

export const checkOpsPermission =
  ({
    permission,
    throwOnDeny = true,
  }: {
    permission: Permission;
    throwOnDeny?: boolean;
  }) =>
  async ({ ctx, next }: PermissionMiddlewareParams<unknown>) => {
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

    // For mutating endpoints, `kind: "none"` is a hard FORBIDDEN. For status
    // probes that want to *report* "no access" without throwing (lw#3584
    // — see ops.getScope), pass `{ throwOnDeny: false }` so the middleware
    // populates `ctx.opsScope = { kind: "none" }` and the procedure handler
    // can branch on it.
    if (opsScope.kind === "none" && throwOnDeny) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have permission to access ops resources",
      });
    }

    ctx.opsScope = opsScope;
    ctx.permissionChecked = true;
    return next();
  };
