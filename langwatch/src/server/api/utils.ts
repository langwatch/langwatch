import {
  type PrismaClient,
  OrganizationUserRole,
  ProjectSensitiveDataVisibilityLevel,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import type { Session } from "~/server/auth";
import { VisibilityWindowService } from "~/server/app-layer/traces/visibility-window.service";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { TtlCache } from "~/server/utils/ttlCache";
import { FREE_VISIBILITY_DAYS } from "../../../ee/licensing/constants";
import type { Protections } from "../elasticsearch/protections";
import { hasProjectPermission, isDemoProject } from "./rbac";
import { getApp } from "~/server/app-layer/app";

/**
 * Cache: projectId -> visibilityDays sentinel ("none" = no window). Plan
 * resolution is an uncached Prisma read; a short TTL keeps the per-request
 * cost near zero while plan changes still apply within a minute — well
 * inside ADR-028's "next read" intent. The CUTOFF itself is computed fresh
 * per call (it moves with `now`), only the plan lookup is cached.
 */
const visibilityDaysCache = new TtlCache<number | "none">(
  60 * 1000,
  "ttlcache:visibility-days:",
);

/**
 * Resolves the ADR-028 visibility cutoff for a project's organization.
 * Fails CLOSED: unresolvable org or plan errors apply the free-tier window
 * (a leak is irreversible; over-blur is a refresh away).
 */
export async function getVisibilityCutoffMsForProject(
  projectId: string,
): Promise<number | null> {
  const dayMs = 24 * 60 * 60 * 1000;
  const failClosedCutoff = () => Date.now() - FREE_VISIBILITY_DAYS * dayMs;

  const cached = await visibilityDaysCache.get(projectId);
  if (cached !== undefined) {
    return cached === "none" ? null : Date.now() - cached * dayMs;
  }

  try {
    const organizationId = await resolveOrganizationId(projectId);
    if (!organizationId) return failClosedCutoff();
    const cutoffMs = await new VisibilityWindowService(
      getApp().planProvider,
    ).getVisibilityCutoffMs({ organizationId });
    const visibilityDays =
      cutoffMs === null
        ? ("none" as const)
        : Math.round((Date.now() - cutoffMs) / dayMs);
    await visibilityDaysCache.set(projectId, visibilityDays);
    return cutoffMs;
  } catch {
    // Fail-closed results are NOT cached — a transient plan-store error
    // should not pin paying customers to the free window for the TTL.
    return failClosedCutoff();
  }
}

export const extractCheckKeys = (
  inputObject: Record<string, any>,
): string[] => {
  const keys: string[] = [];

  const recurse = (obj: Record<string, any>) => {
    for (const key of Object.keys(obj)) {
      if (
        key.startsWith("check_") ||
        key.startsWith("eval_") ||
        key.startsWith("evaluation_")
      ) {
        keys.push(key);
      }
      if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
        recurse(obj[key]);
      }
    }
  };

  recurse(inputObject);
  return keys;
};

export const flattenObjectKeys = (
  obj: Record<string, any>,
  prefix = "",
): string[] => {
  return Object.entries(obj).reduce((acc: string[], [key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // If it's an object (but not null or an array), recurse
      return [...acc, ...flattenObjectKeys(value, newKey)];
    } else {
      // For non-object values (including arrays), add the key
      return [...acc, newKey];
    }
  }, []);
};

export async function getProtectionsForProject(
  prisma: PrismaClient,
  { projectId }: { projectId: string } & Record<string, unknown>,
): Promise<Protections> {
  const protections = await getUserProtectionsForProject(
    { prisma, session: null, publiclyShared: false },
    { projectId },
  );

  // API key holders have full project access — all roles grant cost:view
  return { ...protections, canSeeCosts: true };
}

// New function for internal operations that need full access
export async function getInternalProtectionsForProject(
  _prisma: PrismaClient,
  { projectId: _projectId }: { projectId: string } & Record<string, unknown>,
): Promise<Protections> {
  return {
    canSeeCosts: true,
    canSeeCapturedInput: true,
    canSeeCapturedOutput: true,
  };
}

export async function getUserProtectionsForProject(
  ctx: {
    prisma: PrismaClient;
    session: Session | null;
    publiclyShared?: boolean;
  },
  { projectId }: { projectId: string } & Record<string, unknown>,
): Promise<Protections> {
  // TODO(afr): Should we show cost if public? I would assume the opposite.
  const canSeeCosts =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    ctx.publiclyShared ||
    (await hasProjectPermission(ctx, projectId, "cost:view"));

  // ADR-028: plan-based visibility window applies to every user-facing read,
  // including public shares — sharing must not be the bypass.
  const visibilityCutoffMs = await getVisibilityCutoffMsForProject(projectId);

  const project = await ctx.prisma.project.findUniqueOrThrow({
    where: { id: projectId, archivedAt: null },
    select: {
      teamId: true,
      capturedInputVisibility: true,
      capturedOutputVisibility: true,
    },
  });

  // For public shares or non-signed in users, we only check project settings
  if (
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    ctx.publiclyShared ||
    !ctx.session?.user?.id ||
    isDemoProject(projectId, "traces:view")
  ) {
    return {
      canSeeCosts,
      canSeeCapturedInput:
        project.capturedInputVisibility ===
        ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
      canSeeCapturedOutput:
        project.capturedOutputVisibility ===
        ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
      visibilityCutoffMs,
    };
  }

  // Check team-level role bindings
  const teamBindings = await ctx.prisma.roleBinding.findMany({
    where: {
      userId: ctx.session.user.id,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: project.teamId,
    },
    select: {
      role: true,
    },
  });

  let isAdminForTeam = teamBindings.some(
    (binding) => binding.role === TeamUserRole.ADMIN,
  );
  let isMemberOfTeam = teamBindings.length > 0;

  if (!isMemberOfTeam) {
    const orgRole = await getApp().organizations.getUserOrgRoleByTeamId({
      userId: ctx.session.user.id,
      teamId: project.teamId,
    });

    if (orgRole === OrganizationUserRole.ADMIN) {
      isMemberOfTeam = true;
      isAdminForTeam = true;
    } else if (orgRole === OrganizationUserRole.MEMBER) {
      isMemberOfTeam = true;
    }
  }

  const obtainVisibilityLevel = (
    visibility: ProjectSensitiveDataVisibilityLevel,
  ): boolean => {
    switch (true) {
      case !isMemberOfTeam:
        return false;
      case visibility === ProjectSensitiveDataVisibilityLevel.REDACTED_TO_ALL:
        return false;
      case visibility === ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL:
        return true;
      case visibility === ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ADMIN:
        return isAdminForTeam;
      default:
        console.error("Unexpected state for visibility:", visibility);
        return false;
    }
  };

  return {
    canSeeCosts,
    canSeeCapturedInput: obtainVisibilityLevel(project.capturedInputVisibility),
    canSeeCapturedOutput: obtainVisibilityLevel(
      project.capturedOutputVisibility,
    ),
    visibilityCutoffMs,
  };
}
