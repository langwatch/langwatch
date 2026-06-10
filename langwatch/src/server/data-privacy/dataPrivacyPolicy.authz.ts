import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
} from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import type {
  DataPrivacyScope,
  DataPrivacyScopeTier,
} from "./dataPrivacyPolicy.repository";

type RBACContext = { prisma: PrismaClient; session: Session | null };

/**
 * Permission required to write a privacy rule at a given tier.
 *
 * This MUST mirror the read side (`getDataPrivacySnapshot`), which advertises
 * a scope as writable using exactly these permissions, so the chip picker
 * never offers a scope the save then rejects:
 *   - ORGANIZATION → organization:manage
 *   - DEPARTMENT   → organization:manage (departments are an org-level lens,
 *                    managed by whoever manages the organization)
 *   - TEAM         → team:manage
 *   - PROJECT      → project:update (a team MEMBER holds project:update but
 *                    not project:manage, and the snapshot already shows them
 *                    their project as writable)
 */
export function requiredDataPrivacyWritePermission(
  scopeType: DataPrivacyScopeTier,
): "organization:manage" | "team:manage" | "project:update" {
  if (scopeType === "ORGANIZATION" || scopeType === "DEPARTMENT") {
    return "organization:manage";
  }
  if (scopeType === "TEAM") return "team:manage";
  return "project:update";
}

async function canWriteScope(
  ctx: RBACContext,
  scope: DataPrivacyScope,
): Promise<boolean> {
  if (!ctx.session) return false;
  if (scope.scopeType === "ORGANIZATION" || scope.scopeType === "DEPARTMENT") {
    const organizationId =
      scope.scopeType === "ORGANIZATION"
        ? scope.scopeId
        : (
            await ctx.prisma.department.findUnique({
              where: { id: scope.scopeId },
              select: { organizationId: true },
            })
          )?.organizationId;
    if (!organizationId) return false;
    return hasOrganizationPermission(
      { prisma: ctx.prisma, session: ctx.session },
      organizationId,
      "organization:manage",
    );
  }
  if (scope.scopeType === "TEAM") {
    return hasTeamPermission(ctx, scope.scopeId, "team:manage");
  }
  return hasProjectPermission(ctx, scope.scopeId, "project:update");
}

/**
 * Throws FORBIDDEN if the caller cannot write a privacy rule at the given
 * scope. The required permission matches what the read snapshot uses to
 * decide the scope is writable, so the UI never offers a scope the save will
 * reject.
 */
export async function assertCanWriteDataPrivacyScope(
  ctx: RBACContext,
  scope: DataPrivacyScope,
): Promise<void> {
  if (await canWriteScope(ctx, scope)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `You need ${requiredDataPrivacyWritePermission(
      scope.scopeType,
    )} on this ${scope.scopeType.toLowerCase()} to change its data privacy.`,
  });
}

/**
 * Resolves the organization that owns a scope target, the anchor every gate
 * on a scope-targeted mutation must check against (NOT a caller-supplied
 * projectId, which could point at a different org). DEPARTMENT resolves
 * through its own table; the universal tiers resolve through theirs. Returns
 * null if the scope target does not exist, which callers should treat as
 * NOT_FOUND.
 */
export async function resolveDataPrivacyScopeOrganizationId(
  ctx: RBACContext,
  scope: DataPrivacyScope,
): Promise<string | null> {
  if (scope.scopeType === "ORGANIZATION") {
    const org = await ctx.prisma.organization.findUnique({
      where: { id: scope.scopeId },
      select: { id: true },
    });
    return org?.id ?? null;
  }
  if (scope.scopeType === "DEPARTMENT") {
    const department = await ctx.prisma.department.findUnique({
      where: { id: scope.scopeId },
      select: { organizationId: true },
    });
    return department?.organizationId ?? null;
  }
  if (scope.scopeType === "TEAM") {
    const team = await ctx.prisma.team.findUnique({
      where: { id: scope.scopeId },
      select: { organizationId: true },
    });
    return team?.organizationId ?? null;
  }
  const project = await ctx.prisma.project.findUnique({
    where: { id: scope.scopeId },
    select: { team: { select: { organizationId: true } } },
  });
  return project?.team?.organizationId ?? null;
}
