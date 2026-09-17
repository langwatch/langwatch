/** Permission vocabulary and transport adapters for the grants engine. */

import { isAdmin } from "@ee/admin/isAdmin";
import type {
  AuthzDenialReason,
  AuthzPermission,
  EnforcedScopeFields,
} from "@langwatch/authz";
import {
  builtinRolePermissions,
  declareAuthzMiddleware,
} from "@langwatch/authz";
import { TRPCError } from "@trpc/server";
import { env } from "~/env.mjs";
import {
  OrganizationUserRole,
  type PrismaClient,
} from "~/generated/prisma/client";
import { authzChecksFor } from "~/server/app-layer/authz/checks";
import {
  LiteMemberRestrictedError,
  MembershipDisabledError,
  ProjectPermissionDeniedError,
} from "~/server/app-layer/permissions/errors";
import type { Session } from "~/server/auth";

export type Permission = AuthzPermission;

/** Permission result translated for the existing transport response. */
export type PermissionResult = {
  permitted: boolean;
  organizationRole: OrganizationUserRole | null;
  denialReason?: AuthzDenialReason;
};

export type PermissionMiddlewareParams<InputType> = {
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

/** A disabled seat takes precedence over role-specific denial messages. */
function membershipDisabledDenial(): TRPCError {
  const disabled = new MembershipDisabledError();
  return new TRPCError({
    code: "UNAUTHORIZED",
    message: disabled.message,
    cause: disabled,
  });
}

/** Supports data-dependent middleware composition; fixed scopes use .permission(). */
export const checkProjectPermission =
  (permission: Permission) =>
  async ({
    ctx,
    input,
    next,
  }: PermissionMiddlewareParams<{ projectId: string }>) => {
    const { permitted, organizationRole, denialReason } =
      await resolveProjectPermission(ctx, input.projectId, permission);

    if (!permitted) {
      if (denialReason === "membership-disabled") {
        throw membershipDisabledDenial();
      }
      if (organizationRole === OrganizationUserRole.EXTERNAL) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "This feature is not available for your account",
          cause: new LiteMemberRestrictedError(
            permission.split(":")[0] ?? "unknown",
          ),
        });
      }
      // The boundary maps the handled cause to its HTTP status and customer code.
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You do not have permission to access this project resource",
        cause: new ProjectPermissionDeniedError(permission),
      });
    }

    ctx.organizationRole = organizationRole;
    ctx.permissionChecked = true;
    return next();
  };

/** Supports data-dependent middleware composition; fixed scopes use .permission(). */
export const checkTeamPermission =
  (permission: Permission) =>
  async ({
    ctx,
    input,
    next,
  }: PermissionMiddlewareParams<{ teamId: string }>) => {
    const { permitted, organizationRole, denialReason } =
      await resolveTeamPermission(ctx, input.teamId, permission);

    if (!permitted) {
      if (denialReason === "membership-disabled") {
        throw membershipDisabledDenial();
      }
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

/** Supports data-dependent middleware composition; fixed scopes use .permission(). */
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

/** The tRPC adapters and batched callers all use the grants engine. */
export async function resolveProjectPermission(
  ctx: { prisma: PrismaClient; session: Session | null },
  projectId: string,
  permission: Permission,
): Promise<PermissionResult> {
  const userId = ctx.session?.user?.id;
  if (!userId) return { permitted: false, organizationRole: null };
  if (isDemoProject(projectId, permission)) {
    return { permitted: true, organizationRole: null };
  }
  const decision = await authzChecksFor(ctx.prisma).checkByIds({
    principal: { type: "user", id: userId },
    permission,
    projectId,
  });
  return {
    permitted: decision.allowed,
    organizationRole: decision.organizationRole,
    denialReason: decision.denialReason,
  };
}

export async function resolveProjectPermissionAny(
  ctx: { prisma: PrismaClient; session: Session | null },
  projectId: string,
  permissions: readonly Permission[],
): Promise<PermissionResult> {
  const userId = ctx.session?.user?.id;
  if (!userId) return { permitted: false, organizationRole: null };
  if (permissions.some((permission) => isDemoProject(projectId, permission))) {
    return { permitted: true, organizationRole: null };
  }
  const decision = await authzChecksFor(ctx.prisma).canAnyByIds({
    principal: { type: "user", id: userId },
    permissions,
    projectId,
  });
  return {
    permitted: decision.allowed,
    organizationRole: decision.organizationRole,
    denialReason: decision.denialReason,
  };
}

export async function hasProjectPermission(
  ctx: { prisma: PrismaClient; session: Session | null },
  projectId: string,
  permission: Permission,
): Promise<boolean> {
  return (await resolveProjectPermission(ctx, projectId, permission)).permitted;
}

export async function resolveTeamPermission(
  ctx: { prisma: PrismaClient; session: Session | null },
  teamId: string,
  permission: Permission,
): Promise<PermissionResult> {
  const userId = ctx.session?.user?.id;
  if (!userId) return { permitted: false, organizationRole: null };
  const decision = await authzChecksFor(ctx.prisma).checkByIds({
    principal: { type: "user", id: userId },
    permission,
    teamId,
  });
  return {
    permitted: decision.allowed,
    organizationRole: decision.organizationRole,
    denialReason: decision.denialReason,
  };
}

export async function hasTeamPermission(
  ctx: { prisma: PrismaClient; session: Session | null },
  teamId: string,
  permission: Permission,
): Promise<boolean> {
  return (await resolveTeamPermission(ctx, teamId, permission)).permitted;
}

export async function hasOrganizationPermission(
  ctx: { prisma: PrismaClient; session: Session },
  organizationId: string,
  permission: Permission,
): Promise<boolean> {
  const userId = ctx.session?.user?.id;
  if (!userId) return false;
  const decision = await authzChecksFor(ctx.prisma).checkByIds({
    principal: { type: "user", id: userId },
    permission,
    organizationId,
  });
  return decision.allowed;
}

/** Membership status determines the explanation for a denied organization check. */
export async function organizationDenialReason({
  ctx,
  organizationId,
}: {
  ctx: { prisma: PrismaClient; session: Session };
  organizationId: string;
}): Promise<AuthzDenialReason | undefined> {
  const userId = ctx.session?.user?.id;
  if (!userId) return void 0;
  const membership = await ctx.prisma.organizationUser.findFirst({
    where: { userId, organizationId },
    select: { disabledAt: true },
  });
  return membership?.disabledAt ? "membership-disabled" : void 0;
}

/** Returns the held subset in caller order from one collected snapshot. */
export async function batchProjectPermissions(
  ctx: { prisma: PrismaClient; session: Session | null },
  args: {
    organizationId: string;
    projectId: string;
    teamId?: string;
    permissions: Permission[];
  },
): Promise<Permission[]> {
  const userId = ctx.session?.user?.id;
  if (!userId) return [];
  const { byPermission } = await authzChecksFor(
    ctx.prisma,
  ).canBatchPermissionsByIds({
    principal: { type: "user", id: userId },
    organizationId: args.organizationId,
    permissions: args.permissions,
    teams: [],
    projects: [{ projectId: args.projectId, teamId: args.teamId }],
  });
  return args.permissions.filter(
    (permission) =>
      byPermission.get(permission)?.projects.get(args.projectId) === true,
  );
}

export async function batchTeamsPermissions(
  ctx: { prisma: PrismaClient; session: Session | null },
  args: {
    organizationId: string;
    teamIds: string[];
    permissions: Permission[];
  },
): Promise<Map<string, Permission[]>> {
  const userId = ctx.session?.user?.id;
  if (!userId) return new Map(args.teamIds.map((id) => [id, []]));
  const { byPermission } = await authzChecksFor(
    ctx.prisma,
  ).canBatchPermissionsByIds({
    principal: { type: "user", id: userId },
    organizationId: args.organizationId,
    permissions: args.permissions,
    teams: args.teamIds.map((teamId) => ({ teamId })),
    projects: [],
  });
  return new Map(
    args.teamIds.map((teamId) => [
      teamId,
      args.permissions.filter(
        (permission) =>
          byPermission.get(permission)?.teams.get(teamId) === true,
      ),
    ]),
  );
}

/** One snapshot answers all requested scopes without a per-permission query fan-out. */
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
  const userId = ctx.session?.user?.id;
  if (!userId)
    return {
      teams: new Map(args.teamIds.map((id) => [id, false])),
      projects: new Map(args.projectIds.map((id) => [id, false])),
    };
  const decision = await authzChecksFor(ctx.prisma).canBatchByIds({
    principal: { type: "user", id: userId },
    permission: args.permission,
    organizationId: args.organizationId,
    teams: args.teamIds.map((teamId) => ({ teamId })),
    projects: args.projectIds.map((projectId) => ({
      projectId,
      teamId: args.projectTeamId[projectId],
    })),
  });
  return { teams: decision.teams, projects: decision.projects };
}

/**
 * Whether `projectId` is the public demo project. The demo grants
 * the demo-viewer permission set to every authenticated user (see `isDemoProject`), so a
 * surface that must NOT be reachable there at all — e.g. the per-user Langy chat,
 * whose conversations belong to whoever actually used Langy on the demo — gates
 * on this directly instead of on the permission check that the demo silently
 * grants.
 */
export function isDemoProjectId(projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  // Prefer dynamic process.env in tests; fall back to validated env.
  const demoId = process.env.DEMO_PROJECT_ID ?? env.DEMO_PROJECT_ID;
  return !!demoId && projectId === demoId;
}

export function isDemoProject(
  projectId: string,
  permission: Permission,
): boolean {
  return (
    isDemoProjectId(projectId) &&
    builtinRolePermissions("demo-viewer").has(permission)
  );
}

/** Declares which scope fields the resolver authorizes against stored data. */
export function authorizeInResolver(enforces: EnforcedScopeFields) {
  return declareAuthzMiddleware(
    {
      kind: "service-authorized",
      reason:
        "the scope is data the resolver loads at runtime; the resolver enforces each claimed field (see `enforces`)",
      permissions: [],
      enforces,
    },
    ({ ctx, next }: PermissionMiddlewareParams<object>) => {
      ctx.permissionChecked = true;
      return next();
    },
  );
}

export type OpsScope = { kind: "none" } | { kind: "platform" };

/** Operator access follows the admin allow-list, including the real impersonator. */
export function resolveOpsScope({
  userEmail,
  impersonatorEmail,
}: {
  userId: string;
  userEmail: string | null | undefined;
  /** Email of the real admin behind an impersonation session, if any. */
  impersonatorEmail?: string | null;
  permission: Permission;
  prisma: unknown;
}): OpsScope {
  if (isAdmin({ email: userEmail }) || isAdmin({ email: impersonatorEmail })) {
    return { kind: "platform" };
  }

  return { kind: "none" };
}

export const checkOpsPermission = ({
  permission,
  throwOnDeny = true,
}: {
  permission: Permission;
  throwOnDeny?: boolean;
}) =>
  declareAuthzMiddleware(
    {
      kind: "custom",
      reason:
        "platform-tier operator check: resolves the admin allow-list into an ops scope no procedure input carries",
      permissions: [permission],
    },
    async ({ ctx, next }: PermissionMiddlewareParams<unknown>) => {
      const user = ctx.session?.user;
      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const opsScope = await resolveOpsScope({
        userId: user.id,
        userEmail: user.email,
        impersonatorEmail: user.impersonator?.email,
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
    },
  );
